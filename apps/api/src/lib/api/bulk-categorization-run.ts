import { prisma, type BulkCategorizationRow, type Prisma } from '@spliit/db'
import {
  DEFAULT_CATEGORY_ID,
  SETTLEMENT_CATEGORY_ID,
  categorizeLocally,
  loadLocaleDictionary,
  categoryConfidenceBand,
  createCategorySearchDocumentsForLocale,
  normalizeSearchText,
  type CategorizerChoice,
  type CategoryEvidence,
  type CategoryId,
} from '@spliit/domain'
import { JOB_NAMES, sendJob } from '@spliit/jobs'

import { categorizeExpensesWithSystemOne } from '../ai/batch-categorize'
import { adaptSystemOneCategory } from '../ai/category-adapters'
import { getRecentExpenseContext } from '../ai/context'
import { loadSystemOneDateNeighbors } from '../ai/system-one-neighbors'
import { enqueueBudgetEvaluation } from '../budgets/enqueue'
import { env } from '../env'
import { getApiBossForWrite } from './boss'
import { bulkUpdateExpenseCategories } from './category-bulk'
import { randomId } from './shared'

export type Candidate = {
  id: string
  title: string
  version: number
  expenseDate: string
  amount: number
  currency: string
}
export type Choice = {
  categoryId: CategoryId
  confidence: number | null
  source: 'local' | 'system-one'
  /** Local matcher strength. This is a heuristic score, not a probability. */
  matchScore?: number
  /** Acceptance floor used when this choice was generated. */
  floor?: number
  /** Optional for older JSON drafts; distinguishes System One alternatives. */
  evidenceKind?: CategoryEvidence['kind']
}
export type Suggestion = Candidate & {
  categoryId: CategoryId
  initialCategoryId?: CategoryId
  rerunFeedback?: boolean
  source: 'local' | 'system-one' | 'none'
  choices: Choice[]
  firstPass?: { categoryId: CategoryId; confidence: number | null }
  secondPass?: { categoryId: CategoryId; confidence: number | null }
  included?: boolean // Existing local runs may still contain this field.
}
export type BulkCategorizationMode = 'local' | 'system-one'

/** Bulk-run modes stored in local run rows. */
export function normalizeBulkCategorizationMode(
  mode: string,
): BulkCategorizationMode {
  if (mode === 'local') return 'local'
  if (mode === 'system-one') return 'system-one'
  throw new Error(`Unsupported bulk categorization mode: ${mode}`)
}

type RoundMetric = {
  round: number
  reviewed: number
  proposed: number
  accepted: number
  changed: number
  missed: number
  abstained: number
}
type Calibration = {
  sample: Suggestion[]
  confirmed: Suggestion[]
  metrics: RoundMetric[]
  existingCategorized: number
  next: 'calibration' | 'full'
  rerunTargetIds?: string[]
}
const calibrationOf = (value: unknown): Calibration => {
  if (
    value &&
    !Array.isArray(value) &&
    typeof value === 'object' &&
    'sample' in value
  ) {
    const calibration = value as Calibration
    return {
      ...calibration,
      sample: list<Suggestion>(calibration.sample),
      confirmed: list<Suggestion>(calibration.confirmed),
      metrics: recalculateRoundMetrics(calibration),
    }
  }
  return {
    sample: [],
    confirmed: [],
    metrics: [],
    existingCategorized: 0,
    next: 'calibration',
  }
}

export function scoreCalibrationRound(
  sample: Suggestion[],
  round: number,
): RoundMetric {
  const proposed = sample.filter(
    (row) =>
      row.initialCategoryId !== undefined &&
      row.initialCategoryId !== DEFAULT_CATEGORY_ID,
  )
  const abstained = sample.filter(
    (row) =>
      row.initialCategoryId === DEFAULT_CATEGORY_ID &&
      row.categoryId === DEFAULT_CATEGORY_ID,
  )
  return {
    round,
    reviewed: sample.length,
    proposed: proposed.length,
    accepted: proposed.filter((row) => row.categoryId === row.initialCategoryId)
      .length,
    changed: proposed.filter((row) => row.categoryId !== row.initialCategoryId)
      .length,
    missed: sample.filter(
      (row) =>
        row.initialCategoryId === DEFAULT_CATEGORY_ID &&
        row.categoryId !== DEFAULT_CATEGORY_ID,
    ).length,
    abstained: abstained.length,
  }
}

function recalculateRoundMetrics(calibration: Calibration): RoundMetric[] {
  let offset = 0
  return calibration.metrics.map((metric) => {
    const sample = calibration.confirmed.slice(offset, offset + metric.reviewed)
    offset += metric.reviewed
    return scoreCalibrationRound(sample, metric.round)
  })
}

export function sampleCalibrationCandidates(
  candidates: Candidate[],
  excluded: Set<string>,
  size = 12,
  random = Math.random,
) {
  const available = candidates
    .filter((row) => !excluded.has(row.id))
    .sort(
      (a, b) =>
        String(a.expenseDate ?? '').localeCompare(
          String(b.expenseDate ?? ''),
        ) || a.id.localeCompare(b.id),
    )
  const count = Math.min(size, available.length)
  const picked: Candidate[] = []
  for (let index = 0; index < count; index++) {
    const start = Math.floor((index * available.length) / count)
    const end = Math.floor(((index + 1) * available.length) / count)
    picked.push(available[start + Math.floor(random() * (end - start))]!)
  }
  return picked
}

export function calibrationDecision(args: {
  total: number
  existingCategorized: number
  confirmed: Suggestion[]
  metrics: RoundMetric[]
}) {
  const { total, existingCategorized, confirmed, metrics } = args
  if (confirmed.length >= total) return 'auto-full' as const
  const ratio =
    (existingCategorized +
      confirmed.filter((row) => row.categoryId !== DEFAULT_CATEGORY_ID)
        .length) /
    Math.max(1, existingCategorized + total)
  const required = Math.min(
    total,
    Math.max(8, Math.min(24, Math.ceil(Math.sqrt(total) * (1 - ratio)))),
  )
  const reviewed = metrics.reduce((sum, metric) => sum + metric.reviewed, 0)
  const accepted = metrics.reduce((sum, metric) => sum + metric.accepted, 0)
  const proposed = metrics.reduce((sum, metric) => sum + metric.proposed, 0)
  const missed = metrics.reduce((sum, metric) => sum + metric.missed, 0)
  if (
    reviewed >= required &&
    (proposed === 0 ? missed === 0 : accepted / proposed >= 0.8) &&
    missed / reviewed <= 0.1
  )
    return 'auto-full' as const
  return metrics.length >= 4
    ? ('offer-full' as const)
    : ('another-round' as const)
}

export function nextCalibrationPhase(
  decision: ReturnType<typeof calibrationDecision>,
) {
  return decision === 'another-round' ? 'calibration' : 'full'
}

export function isManualCategorizationCorrection(row: Suggestion) {
  return (
    row.initialCategoryId !== undefined &&
    row.categoryId !== row.initialCategoryId
  )
}

export function finalReviewCorrections(
  suggestions: Suggestion[],
  calibration: Calibration,
) {
  const calibrationIds = new Set(calibration.confirmed.map((row) => row.id))
  return suggestions.filter(
    (row) =>
      !calibrationIds.has(row.id) && isManualCategorizationCorrection(row),
  )
}

export function hasUnsharedFinalReviewCorrection(
  suggestions: Suggestion[],
  calibration: Calibration,
) {
  return finalReviewCorrections(suggestions, calibration).some(
    (row) => row.rerunFeedback !== true,
  )
}

export function getRerunCandidates(
  suggestions: Suggestion[],
  calibration: Calibration,
) {
  const calibrationIds = new Set(calibration.confirmed.map((row) => row.id))
  return suggestions.filter((row) => {
    if (calibrationIds.has(row.id) || isManualCategorizationCorrection(row))
      return false
    if (row.categoryId === DEFAULT_CATEGORY_ID) return true
    if (row.initialCategoryId !== row.categoryId) return false
    const selected = row.choices.find(
      (choice) => choice.categoryId === row.categoryId,
    )
    if (!selected) return false
    if (selected.source === 'local' && selected.matchScore == null)
      return (
        row.choices.filter(
          (choice) => choice.categoryId !== DEFAULT_CATEGORY_ID,
        ).length > 1
      )
    return (
      categoryConfidenceBand(
        selected.source === 'local' ? selected.matchScore : selected.confidence,
        selected.floor ??
          (selected.source === 'local'
            ? env.CATEGORY_LOCAL_MIN_SCORE
            : env.AI_CATEGORY_MIN_CONFIDENCE),
      ) === 'low'
    )
  })
}

export function getRerunCandidateCounts(
  suggestions: Suggestion[],
  calibration: Calibration,
) {
  const candidates = getRerunCandidates(suggestions, calibration)
  const general = candidates.filter(
    (row) => row.categoryId === DEFAULT_CATEGORY_ID,
  ).length
  return { general, uncertain: candidates.length - general }
}

export function getAutomaticSystemOneTargets(suggestions: Suggestion[]) {
  return suggestions.filter((row) => {
    if (row.categoryId === DEFAULT_CATEGORY_ID) return true
    const selected = row.choices.find(
      (choice) =>
        choice.categoryId === row.categoryId && choice.source === 'system-one',
    )
    return (
      selected != null &&
      categoryConfidenceBand(
        selected.confidence,
        selected.floor ?? env.AI_CATEGORY_MIN_CONFIDENCE,
      ) === 'low'
    )
  })
}

const STRONG_SECOND_PASS_CONFIDENCE = 0.8

export function mergeAutomaticSystemOneSuggestions(
  current: Suggestion[],
  additions: Suggestion[],
) {
  const byId = new Map(additions.map((row) => [row.id, row]))
  return current.map((row) => {
    const addition = byId.get(row.id)
    if (!addition) return row
    const selected = addition.choices.find(
      (choice) => choice.categoryId === addition.categoryId,
    )
    const promote =
      row.categoryId === DEFAULT_CATEGORY_ID &&
      addition.categoryId !== DEFAULT_CATEGORY_ID &&
      (selected?.confidence ?? 0) >= STRONG_SECOND_PASS_CONFIDENCE
    const originalChoice = row.choices.find(
      (choice) => choice.categoryId === row.categoryId,
    )
    const choices = (
      row.categoryId === DEFAULT_CATEGORY_ID
        ? [selected, ...addition.choices, ...row.choices]
        : [originalChoice, selected, ...row.choices, ...addition.choices]
    )
      .filter((choice): choice is Choice => choice !== undefined)
      .filter(
        (choice, index, all) =>
          all.findIndex((other) => other.categoryId === choice.categoryId) ===
          index,
      )
      .slice(0, 3)
    return {
      ...row,
      categoryId: promote ? addition.categoryId : row.categoryId,
      initialCategoryId: promote ? addition.categoryId : row.initialCategoryId,
      source: promote ? ('system-one' as const) : row.source,
      choices,
      firstPass: row.firstPass ?? {
        categoryId: row.initialCategoryId ?? row.categoryId,
        confidence:
          row.choices.find(
            (choice) => choice.categoryId === row.initialCategoryId,
          )?.confidence ?? null,
      },
      secondPass: {
        categoryId: addition.categoryId,
        confidence: selected?.confidence ?? null,
      },
    }
  })
}

export function compareSystemOnePasses(suggestions: Suggestion[]) {
  const reviewed = suggestions.filter((row) => row.firstPass && row.secondPass)
  return {
    reviewed: reviewed.length,
    firstAccepted: reviewed.filter(
      (row) =>
        row.firstPass?.categoryId !== DEFAULT_CATEGORY_ID &&
        row.firstPass?.categoryId === row.categoryId,
    ).length,
    secondAccepted: reviewed.filter(
      (row) =>
        row.secondPass?.categoryId !== DEFAULT_CATEGORY_ID &&
        row.secondPass?.categoryId === row.categoryId,
    ).length,
    firstProposed: reviewed.filter(
      (row) => row.firstPass?.categoryId !== DEFAULT_CATEGORY_ID,
    ).length,
    secondProposed: reviewed.filter(
      (row) => row.secondPass?.categoryId !== DEFAULT_CATEGORY_ID,
    ).length,
    firstMissed: reviewed.filter(
      (row) =>
        row.firstPass?.categoryId === DEFAULT_CATEGORY_ID &&
        row.categoryId !== DEFAULT_CATEGORY_ID,
    ).length,
    secondMissed: reviewed.filter(
      (row) =>
        row.secondPass?.categoryId === DEFAULT_CATEGORY_ID &&
        row.categoryId !== DEFAULT_CATEGORY_ID,
    ).length,
  }
}

export function getRerunTargetCandidates(
  candidates: Candidate[],
  suggestions: Suggestion[],
  calibration: Calibration,
) {
  const ids =
    calibration.rerunTargetIds ??
    getRerunCandidates(suggestions, calibration).map((row) => row.id)
  const byId = new Map(candidates.map((row) => [row.id, row]))
  return ids.map((id) => {
    const candidate = byId.get(id)
    if (!candidate) throw new Error(`Rerun candidate ${id} is missing`)
    return candidate
  })
}

export function changeRunSuggestion(
  row: Suggestion,
  categoryId: CategoryId | undefined,
  include = true,
) {
  if (categoryId === undefined || categoryId === row.categoryId) return row
  return {
    ...row,
    categoryId,
    rerunFeedback: false,
    ...(include ? { included: true } : {}),
  }
}

export function mergeRerunSuggestions(
  current: Suggestion[],
  additions: Suggestion[],
) {
  const byId = new Map(additions.map((row) => [row.id, row]))
  return current.map((row) => {
    const addition = byId.get(row.id)
    return addition
      ? { ...addition, firstPass: row.firstPass, secondPass: row.secondPass }
      : row
  })
}

export type RunData = {
  id: string
  groupId: string
  accountId: string
  mode: string
  status: string
  locale: string
  total: number
  processed: number
  round: number
  applied: number
  skipped: number
  candidateTotal: number
  omitted: number
  revision: number
  attemptId: string | null
  workerToken: string | null
  leaseUntil: Date | null
  calibration: unknown
  examples: unknown
  error: string | null
  updatedAt: Date
}
type FullPassState = { phase: 'first' | 'second' | 'complete' }
const json = (value: unknown): Prisma.InputJsonValue =>
  value as Prisma.InputJsonValue
const list = <T>(value: unknown): T[] =>
  Array.isArray(value) ? (value as T[]) : []
const RUN_LIMIT = 10_000
const CHUNK_SIZE = 25
const PAGE_SIZE = 100
const LEASE_MS = 5 * 60_000
const busy = new Set([
  'QUEUED',
  'PROCESSING',
  'QUEUED_RERUN',
  'RERUNNING',
  'QUEUED_CALIBRATION',
  'CALIBRATING',
])
type Phase = 'calibration' | 'full' | 'rerun'
const queuedStatus = (phase: Phase) =>
  phase === 'calibration'
    ? 'QUEUED_CALIBRATION'
    : phase === 'rerun'
      ? 'QUEUED_RERUN'
      : 'QUEUED'
const runningStatus = (phase: Phase) =>
  phase === 'calibration'
    ? 'CALIBRATING'
    : phase === 'rerun'
      ? 'RERUNNING'
      : 'PROCESSING'
const failedStatus = (phase: Phase) =>
  phase === 'calibration'
    ? 'FAILED_CALIBRATION'
    : phase === 'rerun'
      ? 'FAILED_RERUN'
      : 'FAILED_FULL'
const phaseOfFailure = (status: string): Phase =>
  status === 'FAILED_CALIBRATION'
    ? 'calibration'
    : status === 'FAILED_RERUN'
      ? 'rerun'
      : 'full'
const logRun = (
  runId: string,
  event: string,
  values: Record<string, string | number> = {},
) =>
  console.info(
    JSON.stringify({
      component: 'bulk-categorization',
      runId,
      event,
      ...values,
    }),
  )

function rowToSuggestion(row: BulkCategorizationRow): Suggestion {
  return {
    id: row.expenseId,
    title: row.title,
    version: row.expenseVersion,
    expenseDate: row.expenseDate.toISOString(),
    amount: row.amount,
    currency: row.currency,
    categoryId: row.categoryId as CategoryId,
    ...(row.initialCategoryId
      ? { initialCategoryId: row.initialCategoryId as CategoryId }
      : {}),
    rerunFeedback: row.rerunFeedback,
    source: row.source as Suggestion['source'],
    choices: list<Choice>(row.choices),
    ...(row.firstPass
      ? { firstPass: row.firstPass as Suggestion['firstPass'] }
      : {}),
    ...(row.secondPass
      ? { secondPass: row.secondPass as Suggestion['secondPass'] }
      : {}),
  }
}
const asCandidate = (row: BulkCategorizationRow): Candidate => ({
  id: row.expenseId,
  title: row.title,
  version: row.expenseVersion,
  expenseDate: row.expenseDate.toISOString(),
  amount: row.amount,
  currency: row.currency,
})
const suggestionData = (row: Suggestion) => ({
  categoryId: row.categoryId,
  initialCategoryId: row.initialCategoryId ?? row.categoryId,
  source: row.source,
  choices: json(row.choices),
  ...(row.firstPass ? { firstPass: json(row.firstPass) } : {}),
  ...(row.secondPass ? { secondPass: json(row.secondPass) } : {}),
  manualCorrection: isManualCategorizationCorrection(row),
  rerunEligible:
    getRerunCandidates([row], {
      sample: [],
      confirmed: [],
      metrics: [],
      existingCategorized: 0,
      next: 'full',
    }).length > 0,
})

export async function presentRun(run: RunData | null) {
  if (!run) return null
  const calibration = calibrationOf(run.calibration)
  const [
    sample,
    selected,
    proposedCount,
    changedCount,
    assignedCount,
    newFeedback,
    general,
    uncertain,
    currentMatches,
  ] = await Promise.all([
    prisma.bulkCategorizationRow.findMany({
      where: { runId: run.id, stage: 'SAMPLE' },
      orderBy: { position: 'asc' },
    }),
    prisma.bulkCategorizationRow.count({
      where: { runId: run.id, categoryId: { not: DEFAULT_CATEGORY_ID } },
    }),
    prisma.bulkCategorizationRow.count({
      where: {
        runId: run.id,
        stage: { not: 'CONFIRMED' },
        initialCategoryId: { not: DEFAULT_CATEGORY_ID },
      },
    }),
    prisma.bulkCategorizationRow.count({
      where: {
        runId: run.id,
        stage: { not: 'CONFIRMED' },
        manualCorrection: true,
        rerunFeedback: false,
        initialCategoryId: { not: DEFAULT_CATEGORY_ID },
      },
    }),
    prisma.bulkCategorizationRow.count({
      where: {
        runId: run.id,
        stage: { not: 'CONFIRMED' },
        manualCorrection: true,
        rerunFeedback: false,
        initialCategoryId: DEFAULT_CATEGORY_ID,
      },
    }),
    prisma.bulkCategorizationRow.count({
      where: {
        runId: run.id,
        stage: { not: 'CONFIRMED' },
        manualCorrection: true,
        rerunFeedback: false,
      },
    }),
    prisma.bulkCategorizationRow.count({
      where: {
        runId: run.id,
        rerunEligible: true,
        categoryId: DEFAULT_CATEGORY_ID,
      },
    }),
    prisma.bulkCategorizationRow.count({
      where: {
        runId: run.id,
        rerunEligible: true,
        categoryId: { not: DEFAULT_CATEGORY_ID },
      },
    }),
    prisma.bulkCategorizationRow.count({
      where: {
        runId: run.id,
        stage: { in: ['CONFIRMED', 'SUGGESTED'] },
        categoryId: { not: DEFAULT_CATEGORY_ID },
      },
    }),
  ])
  return {
    id: run.id,
    mode: normalizeBulkCategorizationMode(run.mode),
    status: run.status,
    total: run.total,
    processed: run.processed,
    round: run.round,
    applied: run.applied,
    skipped: run.skipped,
    revision: run.revision,
    reviewCycle: run.attemptId,
    candidateTotal: run.candidateTotal,
    omitted: run.omitted,
    fullPassPhase: (run.examples as FullPassState | null)?.phase ?? 'first',
    calibration: { ...calibration, sample: sample.map(rowToSuggestion) },
    selected,
    currentMatches,
    feedback: {
      proposedCount,
      changedCount,
      assignedCount,
      hasNewCorrection: newFeedback > 0,
      hasCorrections: changedCount + assignedCount > 0,
    },
    rerunCandidates: { general, uncertain },
    stalled:
      busy.has(run.status) &&
      Date.now() - run.updatedAt.getTime() > LEASE_MS * 2,
    error: run.error,
  }
}

export async function getCategorizationReviewPage(
  runId: string,
  cursor: number | undefined,
  limit = PAGE_SIZE,
  filter: 'all' | 'general' = 'all',
) {
  const run = await prisma.bulkCategorizationRun.findUniqueOrThrow({
    where: { id: runId },
    select: { revision: true, status: true, candidateTotal: true },
  })
  if (
    !['REVIEW', 'DONE', 'QUEUED_RERUN', 'RERUNNING', 'FAILED_RERUN'].includes(
      run.status,
    )
  )
    throw new Error('Review is not available')
  const where = {
    runId,
    ...(cursor !== undefined && { reviewOrder: { gt: cursor } }),
    ...(filter === 'general' && { categoryId: DEFAULT_CATEGORY_ID }),
  }
  const [rows, total] = await Promise.all([
    prisma.bulkCategorizationRow.findMany({
      where,
      orderBy: { reviewOrder: 'asc' },
      take: Math.min(PAGE_SIZE, limit),
    }),
    filter === 'general'
      ? prisma.bulkCategorizationRow.count({
          where: { runId, categoryId: DEFAULT_CATEGORY_ID },
        })
      : Promise.resolve(run.candidateTotal),
  ])
  return {
    rows: rows.map(rowToSuggestion),
    total,
    revision: run.revision,
    nextCursor:
      rows.length === Math.min(PAGE_SIZE, limit)
        ? (rows.at(-1)?.reviewOrder ?? null)
        : null,
  }
}

export async function captureCategorizationCandidates(groupId: string) {
  const group = await prisma.group.findUniqueOrThrow({
    where: { id: groupId },
    select: { ledgerId: true },
  })
  const [count, ledger] = await Promise.all([
    prisma.expense.count({
      where: { ledgerId: group.ledgerId, categoryId: DEFAULT_CATEGORY_ID },
    }),
    prisma.ledger.findUniqueOrThrow({
      where: { id: group.ledgerId },
      select: { currencyCode: true, currency: true },
    }),
  ])
  const rows = await prisma.$queryRaw<
    Array<{
      id: string
      title: string
      version: number
      expenseDate: Date
      amount: number
    }>
  >`
    WITH ranked AS (
      SELECT "id", "title", "version", "expenseDate", "amount",
        row_number() OVER (ORDER BY "expenseDate", "id") - 1 AS ordinal
      FROM "Expense"
      WHERE "ledgerId" = ${group.ledgerId} AND "categoryId" = ${DEFAULT_CATEGORY_ID}
    ), bucketed AS (
      SELECT *, floor(ordinal * ${Math.min(count, RUN_LIMIT)}::numeric / ${Math.max(count, 1)})::integer AS bucket
      FROM ranked
    )
    SELECT DISTINCT ON (bucket) "id", "title", "version", "expenseDate", "amount"
    FROM bucketed ORDER BY bucket, ordinal`
  return {
    ledgerId: group.ledgerId,
    count,
    candidates: rows.slice(0, RUN_LIMIT).map((row): Candidate => ({
      id: row.id,
      title: row.title,
      version: row.version,
      expenseDate: row.expenseDate.toISOString(),
      amount: row.amount,
      currency: ledger.currencyCode ?? ledger.currency,
    })),
  }
}

export async function countUncategorizedExpenses(groupId: string) {
  const group = await prisma.group.findUniqueOrThrow({
    where: { id: groupId },
    select: { ledgerId: true },
  })
  return prisma.expense.count({
    where: { ledgerId: group.ledgerId, categoryId: DEFAULT_CATEGORY_ID },
  })
}

export async function startCategorizationRun(args: {
  groupId: string
  accountId: string
  mode: BulkCategorizationMode
  locale: string
}) {
  if (args.mode === 'system-one' && !env.AI_SYSTEM_ONE_API_KEY)
    throw new Error('System One is unavailable')
  const existing = await prisma.bulkCategorizationRun.findUnique({
    where: { groupId: args.groupId },
  })
  if (existing && existing.status !== 'DONE') return presentRun(existing)
  const { ledgerId, count, candidates } = await captureCategorizationCandidates(
    args.groupId,
  )
  const existingCategorized = await prisma.expense.count({
    where: {
      ledgerId,
      categoryId: { notIn: [DEFAULT_CATEGORY_ID, SETTLEMENT_CATEGORY_ID] },
    },
  })
  const id = randomId()
  const attemptId = candidates.length ? randomId() : null
  try {
    await prisma.$transaction(
      async (tx) => {
        if (existing)
          await tx.bulkCategorizationRun.deleteMany({
            where: { id: existing.id, status: 'DONE' },
          })
        await tx.bulkCategorizationRun.create({
          data: {
            id,
            groupId: args.groupId,
            accountId: args.accountId,
            mode: args.mode,
            locale: args.locale,
            status: candidates.length ? 'QUEUED_CALIBRATION' : 'REVIEW',
            total: Math.min(12, candidates.length),
            candidateTotal: candidates.length,
            omitted: Math.max(0, count - candidates.length),
            attemptId,
            calibration: json({
              sample: [],
              confirmed: [],
              metrics: [],
              existingCategorized,
              next: 'calibration',
            }),
            examples: json({ phase: 'first' }),
          },
        })
        for (let offset = 0; offset < candidates.length; offset += 500) {
          await tx.bulkCategorizationRow.createMany({
            data: candidates.slice(offset, offset + 500).map((row, index) => ({
              runId: id,
              expenseId: row.id,
              position: offset + index,
              title: row.title,
              expenseVersion: row.version,
              expenseDate: new Date(row.expenseDate),
              amount: row.amount,
              currency: row.currency,
            })),
          })
        }
      },
      { maxWait: 10000, timeout: 120000 },
    )
  } catch (cause) {
    const active = await prisma.bulkCategorizationRun.findUnique({
      where: { groupId: args.groupId },
    })
    if (active && active.id !== existing?.id) return presentRun(active)
    throw cause
  }
  logRun(id, 'started', {
    mode: args.mode,
    candidates: candidates.length,
    omitted: Math.max(0, count - candidates.length),
  })
  if (attemptId) await enqueueCategorization(id, 'calibration', attemptId)
  return presentRun(
    await prisma.bulkCategorizationRun.findUnique({ where: { id } }),
  )
}

async function enqueueCategorization(
  runId: string,
  phase: Phase,
  attemptId: string,
) {
  try {
    const boss = await getApiBossForWrite()
    const jobId = await sendJob(
      boss,
      JOB_NAMES.BULK_CATEGORIZE,
      { runId, phase, attemptId },
      { retryLimit: 0 },
    )
    if (!jobId) throw new Error('Could not queue categorization')
  } catch (cause) {
    await prisma.bulkCategorizationRun.updateMany({
      where: { id: runId, attemptId, status: queuedStatus(phase) },
      data: {
        status: failedStatus(phase),
        error: cause instanceof Error ? cause.message : String(cause),
      },
    })
    throw cause
  }
}

export async function updateRunSuggestions(
  runId: string,
  revision: number,
  changes: Array<{ expenseId: string; categoryId: CategoryId }>,
) {
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.bulkCategorizationRun.updateMany({
      where: {
        id: runId,
        revision,
        status: { in: ['REVIEW', 'CALIBRATION_REVIEW'] },
      },
      data: { revision: { increment: 1 } },
    })
    if (claimed.count !== 1)
      throw new Error('This review changed. Refresh and try again.')
    const run = await tx.bulkCategorizationRun.findUniqueOrThrow({
      where: { id: runId },
    })
    const allowedStage =
      run.status === 'CALIBRATION_REVIEW'
        ? 'SAMPLE'
        : { in: ['CONFIRMED', 'SUGGESTED'] }
    for (const change of changes) {
      const row = await tx.bulkCategorizationRow.findUnique({
        where: { runId_expenseId: { runId, expenseId: change.expenseId } },
      })
      if (
        !row ||
        (typeof allowedStage === 'string'
          ? row.stage !== allowedStage
          : !allowedStage.in.includes(row.stage))
      )
        throw new Error('Expense is not in this review')
      if (row.categoryId === change.categoryId) continue
      const suggested = changeRunSuggestion(
        rowToSuggestion(row),
        change.categoryId,
      )
      await tx.bulkCategorizationRow.update({
        where: { runId_expenseId: { runId, expenseId: change.expenseId } },
        data: {
          categoryId: change.categoryId,
          rerunFeedback: false,
          manualCorrection: isManualCategorizationCorrection(suggested),
          rerunEligible:
            row.stage === 'SAMPLE'
              ? false
              : getRerunCandidates([suggested], {
                  sample: [],
                  confirmed: [],
                  metrics: [],
                  existingCategorized: 0,
                  next: 'full',
                }).length > 0 && row.stage !== 'CONFIRMED',
        },
      })
    }
    const [selected, newFeedback] = await Promise.all([
      tx.bulkCategorizationRow.count({
        where: { runId, categoryId: { not: DEFAULT_CATEGORY_ID } },
      }),
      tx.bulkCategorizationRow.count({
        where: {
          runId,
          stage: 'SUGGESTED',
          manualCorrection: true,
          rerunFeedback: false,
        },
      }),
    ])
    return {
      revision: run.revision,
      selected,
      general: run.candidateTotal - selected,
      newFeedback,
    }
  })
}

export async function confirmCalibrationRound(runId: string, revision: number) {
  const next = await prisma.$transaction(async (tx) => {
    const claimed = await tx.bulkCategorizationRun.updateMany({
      where: { id: runId, revision, status: 'CALIBRATION_REVIEW' },
      data: { revision: { increment: 1 } },
    })
    if (claimed.count !== 1)
      throw new Error('This review changed. Refresh and try again.')
    const run = await tx.bulkCategorizationRun.findUniqueOrThrow({
      where: { id: runId },
    })
    const calibration = calibrationOf(run.calibration)
    const sample = (
      await tx.bulkCategorizationRow.findMany({
        where: { runId, stage: 'SAMPLE' },
        orderBy: { position: 'asc' },
      })
    ).map(rowToSuggestion)
    if (!sample.length) throw new Error('Calibration sample is empty')
    calibration.confirmed.push(...sample)
    calibration.metrics.push(scoreCalibrationRound(sample, run.round))
    const phase: Phase = nextCalibrationPhase(
      calibrationDecision({
        total: run.candidateTotal,
        existingCategorized: calibration.existingCategorized,
        confirmed: calibration.confirmed,
        metrics: calibration.metrics,
      }),
    )
    calibration.next = phase
    await tx.bulkCategorizationRow.updateMany({
      where: { runId, stage: 'SAMPLE' },
      data: { stage: 'CONFIRMED', rerunEligible: false },
    })
    const attemptId = randomId()
    await tx.bulkCategorizationRun.update({
      where: { id: runId },
      data: {
        calibration: json(calibration),
        status: queuedStatus(phase),
        attemptId,
        workerToken: null,
        leaseUntil: null,
        processed: 0,
        total:
          phase === 'full'
            ? run.candidateTotal - calibration.confirmed.length
            : Math.min(12, run.candidateTotal - calibration.confirmed.length),
      },
    })
    return { phase, attemptId }
  })
  logRun(runId, 'calibration-confirmed', { next: next.phase })
  await enqueueCategorization(runId, next.phase, next.attemptId)
}

async function setReviewOrder(tx: Prisma.TransactionClient, runId: string) {
  await tx.$executeRaw`
    UPDATE "BulkCategorizationRow" AS target SET "reviewOrder" = ranked.ordinal
    FROM (
      SELECT "expenseId", row_number() OVER (
        ORDER BY CASE WHEN "categoryId" = ${DEFAULT_CATEGORY_ID} THEN 0 ELSE 1 END,
          "expenseDate" DESC, "expenseId"
      ) - 1 AS ordinal
      FROM "BulkCategorizationRow" WHERE "runId" = ${runId}
    ) AS ranked
    WHERE target."runId" = ${runId} AND target."expenseId" = ranked."expenseId"`
}

export async function rerunCategorizationRun(runId: string, revision: number) {
  const result = await prisma.$transaction(async (tx) => {
    const claimed = await tx.bulkCategorizationRun.updateMany({
      where: { id: runId, revision, status: 'REVIEW' },
      data: { revision: { increment: 1 } },
    })
    if (claimed.count !== 1)
      throw new Error('This review changed. Refresh and try again.')
    const feedback = await tx.bulkCategorizationRow.count({
      where: {
        runId,
        stage: 'SUGGESTED',
        manualCorrection: true,
        rerunFeedback: false,
      },
    })
    const targets = await tx.bulkCategorizationRow.count({
      where: { runId, stage: 'SUGGESTED', rerunEligible: true },
    })
    if (!feedback || !targets)
      throw new Error('There is no new feedback or eligible expense to rerun')
    await tx.bulkCategorizationRow.updateMany({
      where: { runId, stage: 'SUGGESTED', manualCorrection: true },
      data: { rerunFeedback: true },
    })
    await tx.bulkCategorizationRow.updateMany({
      where: { runId, stage: 'SUGGESTED', rerunEligible: true },
      data: { rerunTarget: true },
    })
    const attemptId = randomId()
    await tx.bulkCategorizationRun.update({
      where: { id: runId },
      data: {
        status: 'QUEUED_RERUN',
        attemptId,
        workerToken: null,
        leaseUntil: null,
        processed: 0,
        total: targets,
        error: null,
      },
    })
    return { attemptId, targets }
  })
  logRun(runId, 'rerun-queued', { targets: result.targets })
  await enqueueCategorization(runId, 'rerun', result.attemptId)
}

export async function applyCategorizationRun(
  runId: string,
  revision: number,
  accountId: string,
  skipExpenseIds: string[] = [],
) {
  const approvedSkips = new Set(skipExpenseIds)
  const result = await prisma.$transaction(
    async (tx) => {
      const claimed = await tx.bulkCategorizationRun.updateMany({
        where: { id: runId, revision, status: 'REVIEW' },
        data: { revision: { increment: 1 } },
      })
      if (claimed.count !== 1)
        throw new Error('This review changed. Refresh and try again.')
      const run = await tx.bulkCategorizationRun.findUniqueOrThrow({
        where: { id: runId },
      })
      const selected = await tx.bulkCategorizationRow.findMany({
        where: { runId, categoryId: { not: DEFAULT_CATEGORY_ID } },
        orderBy: { position: 'asc' },
      })
      const conflicts = await findSaveConflicts(tx, run.groupId, selected)
      if (conflicts.some((row) => !approvedSkips.has(row.expenseId)))
        throw new Error(
          'Some selected expenses changed since this run started. No categories were applied.',
        )
      const skippedIds = new Set(conflicts.map((row) => row.expenseId))
      const applicable = selected.filter(
        (row) => !skippedIds.has(row.expenseId),
      )
      const expectedVersions = new Map(
        applicable.map((row) => [row.expenseId, row.expenseVersion]),
      )
      let applied = 0
      for (let offset = 0; offset < applicable.length; offset += 2000) {
        const chunk = applicable.slice(offset, offset + 2000)
        const update = await bulkUpdateExpenseCategories({
          groupId: run.groupId,
          accountId,
          transaction: tx,
          expectedVersions,
          setBased: true,
          input: {
            groupId: run.groupId,
            fromCategoryId: DEFAULT_CATEGORY_ID,
            changes: chunk.map((row) => ({
              expenseId: row.expenseId,
              categoryId: row.categoryId as CategoryId,
            })),
          },
        })
        if (update.applied !== chunk.length)
          throw new Error(
            'An expense changed while saving. No categories were applied; review the changed expenses and try again.',
          )
        applied += update.applied
      }
      await tx.bulkCategorizationRun.update({
        where: { id: runId },
        data: {
          status: 'DONE',
          processed: selected.length,
          total: selected.length,
          applied,
          skipped: skippedIds.size,
          error: null,
        },
      })
      return { groupId: run.groupId, applied, skipped: skippedIds.size }
    },
    { maxWait: 10000, timeout: 180000 },
  )
  if (result.applied > 0) await enqueueBudgetEvaluation(result.groupId)
  logRun(runId, 'saved', { applied: result.applied })
  return result
}

type SaveConflict = { expenseId: string; title: string }

async function findSaveConflicts(
  tx: Prisma.TransactionClient,
  groupId: string,
  selected: BulkCategorizationRow[],
): Promise<SaveConflict[]> {
  if (!selected.length) return []
  const group = await tx.group.findUniqueOrThrow({
    where: { id: groupId },
    select: { ledgerId: true },
  })
  const live = new Map<string, { version: number; categoryId: string }>()
  for (let offset = 0; offset < selected.length; offset += 1000) {
    const expenses = await tx.expense.findMany({
      where: {
        ledgerId: group.ledgerId,
        id: {
          in: selected.slice(offset, offset + 1000).map((row) => row.expenseId),
        },
      },
      select: { id: true, version: true, categoryId: true },
    })
    for (const expense of expenses) live.set(expense.id, expense)
  }
  return selected
    .filter((row) => {
      const expense = live.get(row.expenseId)
      return (
        !expense ||
        expense.categoryId !== DEFAULT_CATEGORY_ID ||
        expense.version !== row.expenseVersion
      )
    })
    .map((row) => ({ expenseId: row.expenseId, title: row.title }))
}

export async function getCategorizationSaveConflicts(runId: string) {
  const run = await prisma.bulkCategorizationRun.findUniqueOrThrow({
    where: { id: runId },
    select: { groupId: true, status: true },
  })
  if (run.status !== 'REVIEW') return []
  const selected = await prisma.bulkCategorizationRow.findMany({
    where: { runId, categoryId: { not: DEFAULT_CATEGORY_ID } },
    orderBy: { position: 'asc' },
  })
  return findSaveConflicts(prisma, run.groupId, selected)
}

export async function retryCategorizationRun(runId: string, revision: number) {
  const result = await prisma.$transaction(async (tx) => {
    const run = await tx.bulkCategorizationRun.findUniqueOrThrow({
      where: { id: runId },
    })
    const stalled =
      busy.has(run.status) &&
      Date.now() - run.updatedAt.getTime() > LEASE_MS * 2
    if (
      run.revision !== revision ||
      (!run.status.startsWith('FAILED_') && !stalled)
    )
      throw new Error('This run changed. Refresh and try again.')
    const phase = run.status.startsWith('FAILED_')
      ? phaseOfFailure(run.status)
      : run.status.includes('RERUN')
        ? 'rerun'
        : run.status.includes('CALIBRAT')
          ? 'calibration'
          : 'full'
    const attemptId = randomId()
    const claimed = await tx.bulkCategorizationRun.updateMany({
      where: { id: runId, revision },
      data: {
        status: queuedStatus(phase),
        attemptId,
        workerToken: null,
        leaseUntil: null,
        revision: { increment: 1 },
        error: null,
      },
    })
    if (claimed.count !== 1)
      throw new Error('This run changed. Refresh and try again.')
    return { phase, attemptId }
  })
  await enqueueCategorization(runId, result.phase, result.attemptId)
}

export async function discardCategorizationRun(
  runId: string,
  revision: number,
) {
  const deleted = await prisma.bulkCategorizationRun.deleteMany({
    where: { id: runId, revision, status: { not: 'DONE' } },
  })
  if (deleted.count !== 1)
    throw new Error('This run changed. Refresh and try again.')
  logRun(runId, 'discarded')
}

async function claimJob(runId: string, phase: Phase, attemptId: string) {
  const now = new Date()
  const workerToken = randomId()
  const claimed = await prisma.bulkCategorizationRun.updateMany({
    where: {
      id: runId,
      attemptId,
      OR: [
        { status: queuedStatus(phase) },
        { status: runningStatus(phase), leaseUntil: { lt: now } },
      ],
    },
    data: {
      status: runningStatus(phase),
      workerToken,
      leaseUntil: new Date(now.getTime() + LEASE_MS),
    },
  })
  return claimed.count ? workerToken : null
}
async function checkpoint(
  runId: string,
  phase: Phase,
  attemptId: string,
  workerToken: string,
  update: (tx: Prisma.TransactionClient) => Promise<void>,
  processed: number,
) {
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.bulkCategorizationRun.updateMany({
      where: {
        id: runId,
        status: runningStatus(phase),
        attemptId,
        workerToken,
      },
      data: { processed, leaseUntil: new Date(Date.now() + LEASE_MS) },
    })
    if (claimed.count !== 1) throw new Error('This job is no longer current')
    await update(tx)
  })
}
async function finishPhase(
  runId: string,
  phase: Phase,
  attemptId: string,
  workerToken: string,
  update: (tx: Prisma.TransactionClient) => Promise<void>,
) {
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.bulkCategorizationRun.updateMany({
      where: {
        id: runId,
        status: runningStatus(phase),
        attemptId,
        workerToken,
      },
      data: { workerToken: null, leaseUntil: null },
    })
    if (claimed.count !== 1) throw new Error('This job is no longer current')
    await update(tx)
  })
}

export async function processCategorizationJob(
  runId: string,
  phase: Phase,
  attemptId: string,
) {
  const workerToken = await claimJob(runId, phase, attemptId)
  if (!workerToken) return
  const started = Date.now()
  try {
    if (phase === 'calibration')
      await processCalibration(runId, attemptId, workerToken)
    else if (phase === 'rerun')
      await processRerun(runId, attemptId, workerToken)
    else await processFull(runId, attemptId, workerToken)
    logRun(runId, 'job-complete', { phase, durationMs: Date.now() - started })
  } catch (cause) {
    await prisma.bulkCategorizationRun.updateMany({
      where: {
        id: runId,
        attemptId,
        workerToken,
        status: runningStatus(phase),
      },
      data: {
        status: failedStatus(phase),
        workerToken: null,
        leaseUntil: null,
        error: cause instanceof Error ? cause.message : String(cause),
      },
    })
    logRun(runId, 'job-failed', { phase, durationMs: Date.now() - started })
    throw cause
  }
}

export function buildCategorizationFeedback(
  confirmed: Suggestion[],
  _locale: string,
) {
  const positive: Array<{ title: string; categoryId: CategoryId }> = []
  const rejected: Array<{ title: string; rejectedCategoryId: CategoryId }> = []
  const rejectedByTitle = new Map<string, Set<CategoryId>>()
  for (const row of confirmed) {
    if (row.categoryId !== DEFAULT_CATEGORY_ID)
      positive.push({ title: row.title, categoryId: row.categoryId })
    if (
      !row.initialCategoryId ||
      row.initialCategoryId === DEFAULT_CATEGORY_ID ||
      row.initialCategoryId === row.categoryId
    )
      continue
    rejected.push({
      title: row.title,
      rejectedCategoryId: row.initialCategoryId,
    })
    const key = normalizeSearchText(row.title)
    const categories = rejectedByTitle.get(key) ?? new Set<CategoryId>()
    categories.add(row.initialCategoryId)
    rejectedByTitle.set(key, categories)
  }
  return {
    positive,
    rejected,
    isRejected: (title: string, categoryId: CategoryId) =>
      rejectedByTitle.get(normalizeSearchText(title))?.has(categoryId) ?? false,
  }
}

export async function suggestRows(
  run: RunData,
  chunk: Candidate[],
  confirmed: Suggestion[],
  options: {
    dateNeighbors?: boolean
    localContext?: Awaited<ReturnType<typeof prepareLocalContext>>
  } = {},
): Promise<Suggestion[]> {
  const feedback = buildCategorizationFeedback(confirmed, run.locale)
  const localMode = normalizeBulkCategorizationMode(run.mode) === 'local'
  const local = localMode
    ? (options.localContext ?? (await prepareLocalContext(run)))
    : null
  const context = local?.context
  const documents = local?.documents ?? []
  const localThresholds = {
    minScore: env.CATEGORY_LOCAL_MIN_SCORE,
    settlementMinScore: env.CATEGORY_LOCAL_SETTLEMENT_MIN_SCORE,
  }
  const systemOne =
    normalizeBulkCategorizationMode(run.mode) === 'system-one' && chunk.length
      ? await categorizeExpensesWithSystemOne(
          chunk.map((row) => ({
            id: row.id,
            title: row.title,
            expenseDate: row.expenseDate,
          })),
          {
            groupId: run.groupId,
            locale: run.locale,
            examples: feedback.positive,
            rejectedExamples: feedback.rejected,
            neighborsById: options.dateNeighbors
              ? await loadSystemOneDateNeighbors(run.groupId, chunk, confirmed)
              : undefined,
          },
        )
      : new Map()
  return chunk.map((row): Suggestion => {
    const guess = systemOne.get(row.id)
    const rejected = new Set(
      feedback.rejected
        .filter(
          (item) =>
            normalizeSearchText(item.title) === normalizeSearchText(row.title),
        )
        .map((item) => item.rejectedCategoryId),
    )
    const result = localMode
      ? categorizeLocally({
          title: row.title,
          documents,
          memory: context?.expenses ?? [],
          feedback,
          alternativeLimit: 2,
          options: {
            dictionaryEnabled: env.CATEGORY_DICTIONARY_ENABLED,
            historyEnabled: env.CATEGORY_HISTORY_ENABLED,
            thresholds: localThresholds,
          },
        })
      : adaptSystemOneCategory(guess, env.AI_CATEGORY_MIN_CONFIDENCE, rejected)
    const choices: Choice[] = [result.primary, ...result.alternatives]
      .filter((choice): choice is CategorizerChoice => choice !== null)
      .slice(0, 3)
      .map((choice) => ({
        categoryId: choice.categoryId,
        confidence:
          choice.evidence.kind === 'heuristic' ? null : choice.evidence.value,
        source: localMode ? 'local' : 'system-one',
        evidenceKind: choice.evidence.kind,
        ...(choice.evidence.kind === 'heuristic' && {
          matchScore: choice.evidence.value,
        }),
        ...('floor' in choice.evidence && { floor: choice.evidence.floor }),
      }))
    const categoryId = result.categoryId ?? DEFAULT_CATEGORY_ID
    return {
      ...row,
      categoryId,
      initialCategoryId: categoryId,
      source: localMode
        ? result.primary
          ? 'local'
          : 'none'
        : guess
          ? 'system-one'
          : 'none',
      choices,
    }
  })
}

async function prepareLocalContext(run: RunData) {
  await loadLocaleDictionary(run.locale)
  return {
    context: await getRecentExpenseContext(
      run.groupId,
      env.CATEGORY_MEMORY_LIMIT,
    ),
    documents: createCategorySearchDocumentsForLocale(run.locale),
  }
}

async function processCalibration(
  runId: string,
  attemptId: string,
  workerToken: string,
) {
  const run = await prisma.bulkCategorizationRun.findUniqueOrThrow({
    where: { id: runId },
  })
  const sample = await prisma.bulkCategorizationRow.findMany({
    where: { runId, stage: 'SAMPLE' },
    orderBy: { position: 'asc' },
  })
  if (sample.length) {
    await finishPhase(runId, 'calibration', attemptId, workerToken, (tx) =>
      tx.bulkCategorizationRun
        .update({
          where: { id: runId },
          data: { status: 'CALIBRATION_REVIEW' },
        })
        .then(() => undefined),
    )
    return
  }
  const pending = await prisma.bulkCategorizationRow.findMany({
    where: { runId, stage: 'PENDING' },
    orderBy: { position: 'asc' },
  })
  const calibration = calibrationOf(run.calibration)
  const chosen = sampleCalibrationCandidates(
    pending.map(asCandidate),
    new Set(),
    12,
  )
  const suggested = await suggestRows(run, chosen, calibration.confirmed)
  await finishPhase(
    runId,
    'calibration',
    attemptId,
    workerToken,
    async (tx) => {
      for (const row of suggested)
        await tx.bulkCategorizationRow.update({
          where: { runId_expenseId: { runId, expenseId: row.id } },
          data: {
            ...suggestionData(row),
            stage: 'SAMPLE',
            rerunEligible: false,
          },
        })
      await tx.bulkCategorizationRun.update({
        where: { id: runId },
        data: {
          status: 'CALIBRATION_REVIEW',
          round: { increment: 1 },
          total: suggested.length,
          processed: suggested.length,
        },
      })
    },
  )
}

async function processFull(
  runId: string,
  attemptId: string,
  workerToken: string,
) {
  let run = await prisma.bulkCategorizationRun.findUniqueOrThrow({
    where: { id: runId },
  })
  const calibration = calibrationOf(run.calibration)
  const localContext =
    normalizeBulkCategorizationMode(run.mode) === 'local'
      ? await prepareLocalContext(run)
      : undefined
  let state = (run.examples as FullPassState | null)?.phase ?? 'first'
  if (state === 'first') {
    while (true) {
      const pending = await prisma.bulkCategorizationRow.findMany({
        where: { runId, stage: 'PENDING' },
        orderBy: { position: 'asc' },
        take: CHUNK_SIZE,
      })
      if (!pending.length) break
      const additions = await suggestRows(
        run,
        pending.map(asCandidate),
        calibration.confirmed,
        { localContext },
      )
      await checkpoint(
        runId,
        'full',
        attemptId,
        workerToken,
        async (tx) => {
          for (const row of additions)
            await tx.bulkCategorizationRow.update({
              where: { runId_expenseId: { runId, expenseId: row.id } },
              data: { ...suggestionData(row), stage: 'SUGGESTED' },
            })
        },
        run.processed + pending.length,
      )
      run = { ...run, processed: run.processed + pending.length }
    }
    if (normalizeBulkCategorizationMode(run.mode) !== 'system-one') {
      await finishPhase(runId, 'full', attemptId, workerToken, async (tx) => {
        await setReviewOrder(tx, runId)
        await tx.bulkCategorizationRun.update({
          where: { id: runId },
          data: { status: 'REVIEW', examples: json({ phase: 'complete' }) },
        })
      })
      return
    }
    let cursor = 0
    let targets = 0
    while (true) {
      const rows = await prisma.bulkCategorizationRow.findMany({
        where: { runId, stage: 'SUGGESTED', position: { gte: cursor } },
        orderBy: { position: 'asc' },
        take: 500,
      })
      if (!rows.length) break
      const ids = getAutomaticSystemOneTargets(rows.map(rowToSuggestion)).map(
        (row) => row.id,
      )
      if (ids.length)
        await checkpoint(
          runId,
          'full',
          attemptId,
          workerToken,
          async (tx) => {
            await tx.bulkCategorizationRow.updateMany({
              where: { runId, expenseId: { in: ids } },
              data: { secondPassTarget: true },
            })
          },
          run.processed,
        )
      targets += ids.length
      cursor = rows.at(-1)!.position + 1
    }
    await checkpoint(
      runId,
      'full',
      attemptId,
      workerToken,
      (tx) =>
        tx.bulkCategorizationRun
          .update({
            where: { id: runId },
            data: {
              examples: json({ phase: 'second' }),
              processed: 0,
              total: targets,
            },
          })
          .then(() => undefined),
      0,
    )
    run = { ...run, processed: 0, total: targets }
    state = 'second'
  }
  if (state === 'second') {
    while (true) {
      const pending = await prisma.bulkCategorizationRow.findMany({
        where: { runId, secondPassTarget: true },
        orderBy: { position: 'asc' },
        take: CHUNK_SIZE,
      })
      if (!pending.length) break
      const additions = await suggestRows(
        run,
        pending.map(asCandidate),
        calibration.confirmed,
        { dateNeighbors: true },
      )
      const current = pending.map(rowToSuggestion)
      const merged = mergeAutomaticSystemOneSuggestions(current, additions)
      await checkpoint(
        runId,
        'full',
        attemptId,
        workerToken,
        async (tx) => {
          for (const row of merged)
            await tx.bulkCategorizationRow.update({
              where: { runId_expenseId: { runId, expenseId: row.id } },
              data: { ...suggestionData(row), secondPassTarget: false },
            })
        },
        run.processed + pending.length,
      )
      run = { ...run, processed: run.processed + pending.length }
    }
    await finishPhase(runId, 'full', attemptId, workerToken, async (tx) => {
      await setReviewOrder(tx, runId)
      await tx.bulkCategorizationRun.update({
        where: { id: runId },
        data: { status: 'REVIEW', examples: json({ phase: 'complete' }) },
      })
    })
  }
}

async function processRerun(
  runId: string,
  attemptId: string,
  workerToken: string,
) {
  let run = await prisma.bulkCategorizationRun.findUniqueOrThrow({
    where: { id: runId },
  })
  const examples = (
    await prisma.bulkCategorizationRow.findMany({
      where: {
        runId,
        OR: [
          { stage: 'CONFIRMED' },
          { stage: 'SUGGESTED', manualCorrection: true },
        ],
      },
    })
  ).map(rowToSuggestion)
  const localContext =
    normalizeBulkCategorizationMode(run.mode) === 'local'
      ? await prepareLocalContext(run)
      : undefined
  while (true) {
    const pending = await prisma.bulkCategorizationRow.findMany({
      where: { runId, rerunTarget: true },
      orderBy: { position: 'asc' },
      take: CHUNK_SIZE,
    })
    if (!pending.length) break
    const additions = await suggestRows(
      run,
      pending.map(asCandidate),
      examples,
      { localContext },
    )
    await checkpoint(
      runId,
      'rerun',
      attemptId,
      workerToken,
      async (tx) => {
        for (const row of additions)
          await tx.bulkCategorizationRow.update({
            where: { runId_expenseId: { runId, expenseId: row.id } },
            data: {
              ...suggestionData(row),
              rerunTarget: false,
              firstPass:
                pending.find((item) => item.expenseId === row.id)?.firstPass ??
                undefined,
              secondPass:
                pending.find((item) => item.expenseId === row.id)?.secondPass ??
                undefined,
            },
          })
      },
      run.processed + pending.length,
    )
    run = { ...run, processed: run.processed + pending.length }
  }
  await finishPhase(runId, 'rerun', attemptId, workerToken, async (tx) => {
    await setReviewOrder(tx, runId)
    await tx.bulkCategorizationRun.update({
      where: { id: runId },
      data: { status: 'REVIEW', processed: 0 },
    })
  })
}

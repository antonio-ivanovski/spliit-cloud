import { prisma, type Prisma } from '@spliit/db'
import {
  DEFAULT_CATEGORY_ID,
  SETTLEMENT_CATEGORY_ID,
  loadLocaleDictionary,
  categoryConfidenceBand,
  createCategorySearchDocumentsForLocale,
  suggestCategoryRunnersUp,
  suggestCategoryFromTitleForLocale,
  type CategoryId,
} from '@spliit/domain'
import { JOB_NAMES, sendJob } from '@spliit/jobs'

import { categorizeExpensesWithJev } from '../ai/batch-categorize'
import { getRecentExpenseContext } from '../ai/context'
import { loadJevDateNeighbors } from '../ai/jev-neighbors'
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
  source: 'local' | 'jev'
  /** Local matcher strength. This is a heuristic score, not a probability. */
  matchScore?: number
  /** Acceptance floor used when this choice was generated. */
  floor?: number
}
export type Suggestion = Candidate & {
  categoryId: CategoryId
  initialCategoryId?: CategoryId
  rerunFeedback?: boolean
  source: 'local' | 'jev' | 'none'
  choices: Choice[]
  firstPass?: { categoryId: CategoryId; confidence: number | null }
  secondPass?: { categoryId: CategoryId; confidence: number | null }
  included?: boolean // Existing local runs may still contain this field.
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
  )
    return {
      ...(value as Calibration),
      metrics: recalculateRoundMetrics(value as Calibration),
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

export function getAutomaticJevTargets(suggestions: Suggestion[]) {
  return suggestions.filter((row) => {
    if (row.categoryId === DEFAULT_CATEGORY_ID) return true
    const selected = row.choices.find(
      (choice) =>
        choice.categoryId === row.categoryId && choice.source === 'jev',
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

export function mergeAutomaticJevSuggestions(
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
      source: promote ? ('jev' as const) : row.source,
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

export function compareJevPasses(suggestions: Suggestion[]) {
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
  candidates: unknown
  calibration: unknown
  examples: unknown
  suggestions: unknown
  error: string | null
}
type FullPassState = {
  phase: 'second' | 'complete'
  targetIds: string[]
}
function fullPassStateOf(value: unknown): FullPassState | null {
  if (
    !value ||
    Array.isArray(value) ||
    typeof value !== 'object' ||
    !('phase' in value)
  )
    return null
  const state = value as FullPassState
  return (state.phase === 'second' || state.phase === 'complete') &&
    Array.isArray(state.targetIds)
    ? state
    : null
}
const list = <T>(value: unknown): T[] =>
  Array.isArray(value) ? (value as T[]) : []
const json = (value: unknown): Prisma.InputJsonValue =>
  value as Prisma.InputJsonValue

export function presentRun(run: RunData | null) {
  if (!run) return null
  const calibration = calibrationOf(run.calibration)
  const suggestions = list<Suggestion>(run.suggestions)
  return {
    id: run.id,
    mode: run.mode as 'local' | 'jev',
    status: run.status,
    total: run.total,
    processed: run.processed,
    round: run.round,
    applied: run.applied,
    skipped: run.skipped,
    candidateTotal: list<Candidate>(run.candidates).length,
    fullPassPhase: fullPassStateOf(run.examples)?.phase ?? 'first',
    jevPassComparison:
      run.status === 'DONE' && run.mode === 'jev'
        ? compareJevPasses(suggestions)
        : null,
    calibration,
    rerunCandidates: getRerunCandidateCounts(suggestions, calibration),
    suggestions: suggestions.map((row) => ({
      ...row,
      categoryId: row.included === false ? DEFAULT_CATEGORY_ID : row.categoryId,
      choices:
        row.choices ??
        (row.categoryId !== DEFAULT_CATEGORY_ID
          ? [
              {
                categoryId: row.categoryId,
                confidence: null,
                source: 'local' as const,
              },
            ]
          : []),
    })),
    error: run.error,
  }
}

async function groupCandidates(groupId: string): Promise<Candidate[]> {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { ledgerId: true },
  })
  if (!group) throw new Error('Group not found')
  const rows = await prisma.expense.findMany({
    where: { ledgerId: group.ledgerId, categoryId: DEFAULT_CATEGORY_ID },
    select: {
      id: true,
      title: true,
      version: true,
      expenseDate: true,
      amount: true,
    },
    orderBy: { expenseDate: 'asc' },
  })
  const ledger = await prisma.ledger.findUniqueOrThrow({
    where: { id: group.ledgerId },
    select: { currencyCode: true, currency: true },
  })
  return rows.map((row) => ({
    ...row,
    expenseDate: row.expenseDate.toISOString(),
    currency: ledger.currencyCode ?? ledger.currency,
  }))
}

export async function countUncategorizedExpenses(groupId: string) {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { ledgerId: true },
  })
  if (!group) throw new Error('Group not found')
  return prisma.expense.count({
    where: { ledgerId: group.ledgerId, categoryId: DEFAULT_CATEGORY_ID },
  })
}

export async function startCategorizationRun(args: {
  groupId: string
  accountId: string
  mode: 'local' | 'jev'
  locale: string
}) {
  if (args.mode === 'jev' && !env.AI_SYSTEM_ONE_API_KEY)
    throw new Error('Jev is unavailable')
  const candidates = await groupCandidates(args.groupId)
  const group = await prisma.group.findUniqueOrThrow({
    where: { id: args.groupId },
    select: { ledgerId: true },
  })
  const existingCategorized = await prisma.expense.count({
    where: {
      ledgerId: group.ledgerId,
      categoryId: { notIn: [DEFAULT_CATEGORY_ID, SETTLEMENT_CATEGORY_ID] },
    },
  })
  const existing = await prisma.bulkCategorizationRun.findUnique({
    where: { groupId: args.groupId },
  })
  if (
    existing &&
    [
      'QUEUED',
      'PROCESSING',
      'APPLYING',
      'QUEUED_RERUN',
      'RERUNNING',
      'QUEUED_CALIBRATION',
      'CALIBRATING',
    ].includes(existing.status)
  )
    return presentRun(existing)
  const id = randomId()
  const run = await prisma.bulkCategorizationRun.upsert({
    where: { groupId: args.groupId },
    create: {
      id,
      ...args,
      status: 'QUEUED_CALIBRATION',
      total: candidates.length,
      candidates: json(candidates),
      calibration: json({
        sample: [],
        confirmed: [],
        metrics: [],
        existingCategorized,
        next: 'calibration',
      }),
    },
    update: {
      id,
      accountId: args.accountId,
      mode: args.mode,
      locale: args.locale,
      status: 'QUEUED_CALIBRATION',
      total: candidates.length,
      processed: 0,
      round: 0,
      applied: 0,
      skipped: 0,
      candidates: json(candidates),
      calibration: json({
        sample: [],
        confirmed: [],
        metrics: [],
        existingCategorized,
        next: 'calibration',
      }),
      examples: json([]),
      suggestions: json([]),
      error: null,
    },
  })
  if (candidates.length) await enqueueCategorization(run.id, 'calibration')
  else
    await prisma.bulkCategorizationRun.update({
      where: { id: run.id },
      data: { status: 'REVIEW' },
    })
  return presentRun(
    await prisma.bulkCategorizationRun.findUnique({ where: { id: run.id } }),
  )
}

async function enqueueCategorization(
  runId: string,
  phase: 'calibration' | 'full' | 'rerun' | 'apply',
) {
  try {
    const boss = await getApiBossForWrite()
    const jobId = await sendJob(
      boss,
      JOB_NAMES.BULK_CATEGORIZE,
      { runId, phase },
      { retryLimit: 0 },
    )
    if (!jobId) throw new Error('Could not queue categorization')
  } catch (cause) {
    await prisma.bulkCategorizationRun.update({
      where: { id: runId },
      data: {
        status:
          phase === 'apply'
            ? 'FAILED_APPLY'
            : phase === 'rerun'
              ? 'FAILED_RERUN'
              : phase === 'calibration'
                ? 'FAILED_CALIBRATION'
                : 'FAILED_FULL',
        error: cause instanceof Error ? cause.message : String(cause),
      },
    })
    throw cause
  }
}

export async function updateRunSuggestions(
  runId: string,
  changes: Array<{
    expenseId: string
    categoryId?: CategoryId
  }>,
) {
  const run = await prisma.bulkCategorizationRun.findUniqueOrThrow({
    where: { id: runId },
  })
  if (!['REVIEW', 'CALIBRATION_REVIEW'].includes(run.status))
    throw new Error('Run is not ready for review')
  const byId = new Map(changes.map((change) => [change.expenseId, change]))
  if (run.status === 'CALIBRATION_REVIEW') {
    const calibration = calibrationOf(run.calibration)
    calibration.sample = calibration.sample.map((row) => {
      const change = byId.get(row.id)
      return change ? changeRunSuggestion(row, change.categoryId, false) : row
    })
    return presentRun(
      await prisma.bulkCategorizationRun.update({
        where: { id: runId },
        data: { calibration: json(calibration) },
      }),
    )
  }
  const suggestions = list<Suggestion>(run.suggestions).map((row) => {
    const change = byId.get(row.id)
    return change ? changeRunSuggestion(row, change.categoryId) : row
  })
  return presentRun(
    await prisma.bulkCategorizationRun.update({
      where: { id: runId },
      data: { suggestions: json(suggestions) },
    }),
  )
}

export async function confirmCalibrationRound(runId: string) {
  const run = await prisma.bulkCategorizationRun.findUniqueOrThrow({
    where: { id: runId },
  })
  if (run.status !== 'CALIBRATION_REVIEW')
    throw new Error('Calibration is not ready for review')
  const calibration = calibrationOf(run.calibration)
  const sample = calibration.sample
  if (!sample.length) throw new Error('Calibration sample is empty')
  calibration.confirmed.push(...sample)
  calibration.sample = []
  const metric = scoreCalibrationRound(sample, run.round)
  calibration.metrics.push(metric)
  const decision = calibrationDecision({
    total: list<Candidate>(run.candidates).length,
    existingCategorized: calibration.existingCategorized,
    confirmed: calibration.confirmed,
    metrics: calibration.metrics,
  })
  const phase = nextCalibrationPhase(decision)
  calibration.next = phase
  await prisma.bulkCategorizationRun.update({
    where: { id: runId },
    data: {
      calibration: json(calibration),
      suggestions: json(calibration.confirmed),
      status: phase === 'full' ? 'QUEUED' : 'QUEUED_CALIBRATION',
      processed: 0,
      total:
        list<Candidate>(run.candidates).length - calibration.confirmed.length,
    },
  })
  await enqueueCategorization(runId, phase)
}

export async function rerunCategorizationRun(runId: string) {
  const run = await prisma.bulkCategorizationRun.findUniqueOrThrow({
    where: { id: runId },
  })
  if (run.status !== 'REVIEW') throw new Error('Run is not ready for review')
  const calibration = calibrationOf(run.calibration)
  const suggestions = list<Suggestion>(run.suggestions)
  const corrections = finalReviewCorrections(suggestions, calibration)
  if (!hasUnsharedFinalReviewCorrection(suggestions, calibration))
    throw new Error('Make a new category correction before rerunning')
  const candidates = getRerunCandidates(suggestions, calibration)
  if (!candidates.length)
    throw new Error('There are no remaining eligible expenses to rerun')
  const correctionIds = new Set(corrections.map((row) => row.id))
  const markedSuggestions = suggestions.map((row) =>
    correctionIds.has(row.id) ? { ...row, rerunFeedback: true } : row,
  )
  calibration.rerunTargetIds = candidates.map((row) => row.id)
  await prisma.bulkCategorizationRun.update({
    where: { id: runId },
    data: {
      status: 'QUEUED_RERUN',
      processed: 0,
      total: candidates.length,
      suggestions: json(markedSuggestions),
      calibration: json(calibration),
      error: null,
    },
  })
  await enqueueCategorization(runId, 'rerun')
}

export async function applyCategorizationRun(runId: string) {
  const result = await prisma.$transaction(
    async (tx) => {
      const run = await tx.bulkCategorizationRun.findUniqueOrThrow({
        where: { id: runId },
      })
      if (run.status !== 'REVIEW')
        throw new Error('Run is not ready for review')
      const selected = list<Suggestion>(run.suggestions).filter(
        (row) =>
          row.categoryId !== DEFAULT_CATEGORY_ID && row.included !== false,
      )
      const expectedVersions = new Map(
        selected.map((row) => [row.id, row.version]),
      )
      let applied = 0
      for (let offset = 0; offset < selected.length; offset += 2000) {
        const chunk = selected.slice(offset, offset + 2000)
        const result = await bulkUpdateExpenseCategories({
          groupId: run.groupId,
          accountId: run.accountId,
          transaction: tx,
          expectedVersions,
          input: {
            groupId: run.groupId,
            fromCategoryId: DEFAULT_CATEGORY_ID,
            changes: chunk.map((row) => ({
              expenseId: row.id,
              categoryId: row.categoryId,
            })),
          },
        })
        if (result.applied !== chunk.length)
          throw new Error(
            'An expense changed while saving. No categories were applied; review the latest expenses and try again.',
          )
        applied += result.applied
      }
      const updated = await tx.bulkCategorizationRun.updateMany({
        where: { id: runId, status: 'REVIEW' },
        data: {
          status: 'DONE',
          processed: selected.length,
          total: selected.length,
          applied,
          skipped: 0,
          error: null,
        },
      })
      if (updated.count !== 1)
        throw new Error('The categorization review changed before it was saved')
      return { groupId: run.groupId, applied, skipped: 0 }
    },
    { maxWait: 10000, timeout: 60000 },
  )
  if (result.applied > 0) await enqueueBudgetEvaluation(result.groupId)
  return result
}

export async function retryCategorizationRun(runId: string) {
  const run = await prisma.bulkCategorizationRun.findUniqueOrThrow({
    where: { id: runId },
  })
  if (!run.status.startsWith('FAILED_')) throw new Error('Run has not failed')
  const phase =
    run.status === 'FAILED_APPLY'
      ? 'apply'
      : run.status === 'FAILED_RERUN'
        ? 'rerun'
        : run.status === 'FAILED_CALIBRATION'
          ? 'calibration'
          : 'full'
  const calibration = calibrationOf(run.calibration)
  const rerunCandidates =
    phase === 'rerun'
      ? getRerunTargetCandidates(
          list<Candidate>(run.candidates),
          list<Suggestion>(run.suggestions),
          calibration,
        )
      : null
  if (rerunCandidates && rerunCandidates.length === 0) {
    await prisma.bulkCategorizationRun.update({
      where: { id: runId },
      data: { status: 'REVIEW', processed: 0, error: null },
    })
    return
  }
  if (rerunCandidates)
    calibration.rerunTargetIds = rerunCandidates.map((row) => row.id)
  await prisma.bulkCategorizationRun.update({
    where: { id: runId },
    data: {
      status:
        phase === 'apply'
          ? 'APPLYING'
          : phase === 'rerun'
            ? 'QUEUED_RERUN'
            : phase === 'calibration'
              ? 'QUEUED_CALIBRATION'
              : 'QUEUED',
      ...(rerunCandidates
        ? {
            total: rerunCandidates.length,
            processed: 0,
            calibration: json(calibration),
          }
        : {}),
      error: null,
    },
  })
  await enqueueCategorization(runId, phase)
}

export async function discardCategorizationRun(runId: string) {
  const deleted = await prisma.bulkCategorizationRun.deleteMany({
    where: { id: runId, status: { not: 'APPLYING' } },
  })
  if (deleted.count === 0)
    throw new Error('This run cannot be discarded while saving categories')
}

export async function processCategorizationJob(
  runId: string,
  phase: 'calibration' | 'full' | 'rerun' | 'apply',
) {
  try {
    if (phase === 'apply') await processApply(runId)
    else if (phase === 'calibration') await processCalibration(runId)
    else if (phase === 'rerun') await processRerun(runId)
    else await processFull(runId)
  } catch (cause) {
    const current = await prisma.bulkCategorizationRun.findUnique({
      where: { id: runId },
    })
    if (!current) return
    await prisma.bulkCategorizationRun.update({
      where: { id: runId },
      data: {
        status:
          phase === 'apply'
            ? 'FAILED_APPLY'
            : phase === 'rerun'
              ? 'FAILED_RERUN'
              : phase === 'calibration'
                ? 'FAILED_CALIBRATION'
                : 'FAILED_FULL',
        error: cause instanceof Error ? cause.message : String(cause),
      },
    })
    throw cause
  }
}

export function buildCategorizationFeedback(
  confirmed: Suggestion[],
  locale: string,
) {
  const positive: Array<{ title: string; categoryId: CategoryId }> = []
  const rejected: Array<{
    title: string
    rejectedCategoryId: CategoryId
  }> = []
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
    const key = row.title.trim().toLocaleLowerCase(locale)
    const categories = rejectedByTitle.get(key) ?? new Set<CategoryId>()
    categories.add(row.initialCategoryId)
    rejectedByTitle.set(key, categories)
  }
  return {
    positive,
    rejected,
    isRejected: (title: string, categoryId: CategoryId) =>
      rejectedByTitle
        .get(title.trim().toLocaleLowerCase(locale))
        ?.has(categoryId) ?? false,
  }
}

export async function suggestRows(
  run: RunData,
  chunk: Candidate[],
  confirmed: Suggestion[],
  options: { dateNeighbors?: boolean } = {},
): Promise<Suggestion[]> {
  const feedback = buildCategorizationFeedback(confirmed, run.locale)
  const isRejected = feedback.isRejected
  const localMode = run.mode === 'local'
  if (localMode) await loadLocaleDictionary(run.locale)
  const context = localMode
    ? await getRecentExpenseContext(run.groupId, 200)
    : null
  const hints = [...feedback.positive, ...(context?.expenses ?? [])]
  const documents = localMode
    ? createCategorySearchDocumentsForLocale(run.locale)
    : []
  const localThresholds = {
    minScore: env.CATEGORY_LOCAL_MIN_SCORE,
    settlementMinScore: env.CATEGORY_LOCAL_SETTLEMENT_MIN_SCORE,
  }
  const local = new Map<
    string,
    { id: CategoryId; score: number; source: string }
  >()
  for (const row of localMode ? chunk : []) {
    const hit = suggestCategoryFromTitleForLocale(
      row.title,
      run.locale,
      hints,
      {
        dictionaryEnabled: env.CATEGORY_DICTIONARY_ENABLED,
        historyEnabled: env.CATEGORY_HISTORY_ENABLED,
        thresholds: localThresholds,
      },
    )
    if (
      hit &&
      hit.id !== DEFAULT_CATEGORY_ID &&
      hit.id !== SETTLEMENT_CATEGORY_ID &&
      !isRejected(row.title, hit.id)
    )
      local.set(row.id, hit)
  }
  const jev =
    run.mode === 'jev' && chunk.length
      ? await categorizeExpensesWithJev(
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
              ? await loadJevDateNeighbors(run.groupId, chunk, confirmed)
              : undefined,
          },
        )
      : new Map()
  return chunk.map((row): Suggestion => {
    const hit = local.get(row.id)
    if (hit) {
      const runners = env.CATEGORY_DICTIONARY_ENABLED
        ? suggestCategoryRunnersUp(row.title, documents, {
            excludeIds: [hit.id],
            limit: 2,
            thresholds: localThresholds,
          }).filter((runner) => !isRejected(row.title, runner.id))
        : []
      const floor =
        hit.source === 'history' ? 0.75 : env.CATEGORY_LOCAL_MIN_SCORE
      const choices: Choice[] = [
        {
          categoryId: hit.id,
          confidence: null,
          source: 'local',
          matchScore: hit.score,
          floor,
        },
      ]
      for (const runner of runners)
        choices.push({
          categoryId: runner.id,
          confidence: null,
          source: 'local',
          matchScore: runner.score,
          floor: env.CATEGORY_LOCAL_MIN_SCORE,
        })
      return {
        ...row,
        categoryId: hit.id,
        initialCategoryId: hit.id,
        source: 'local',
        choices,
      }
    }
    const guess = jev.get(row.id)
    if (!guess && localMode) {
      const alternatives = env.CATEGORY_DICTIONARY_ENABLED
        ? suggestCategoryRunnersUp(row.title, documents, {
            limit: 2,
            thresholds: localThresholds,
          }).filter((runner) => !isRejected(row.title, runner.id))
        : []
      return {
        ...row,
        categoryId: DEFAULT_CATEGORY_ID,
        initialCategoryId: DEFAULT_CATEGORY_ID,
        source: 'none',
        choices: alternatives.map((runner) => ({
          categoryId: runner.id,
          confidence: null,
          source: 'local',
          matchScore: runner.score,
          floor: env.CATEGORY_LOCAL_MIN_SCORE,
        })),
      }
    }
    if (!guess)
      return {
        ...row,
        categoryId: DEFAULT_CATEGORY_ID,
        initialCategoryId: DEFAULT_CATEGORY_ID,
        source: 'none',
        choices: [],
      }
    const choices: Choice[] = []
    const addChoice = (categoryId: CategoryId, confidence: number) => {
      if (
        categoryId === DEFAULT_CATEGORY_ID ||
        categoryId === SETTLEMENT_CATEGORY_ID ||
        choices.some((choice) => choice.categoryId === categoryId) ||
        isRejected(row.title, categoryId)
      )
        return
      choices.push({
        categoryId,
        confidence,
        source: 'jev',
        floor: env.AI_CATEGORY_MIN_CONFIDENCE,
      })
    }
    if (
      guess.categoryId !== DEFAULT_CATEGORY_ID &&
      !isRejected(row.title, guess.categoryId)
    )
      addChoice(guess.categoryId, guess.confidence)
    for (const choice of guess.probabilities) {
      if (choices.length >= 3) break
      if (choice.probability >= 0.15)
        addChoice(choice.categoryId, choice.probability)
    }
    const categoryId =
      choices.find(
        (choice) =>
          choice.confidence !== null &&
          choice.confidence >= env.AI_CATEGORY_MIN_CONFIDENCE,
      )?.categoryId ?? DEFAULT_CATEGORY_ID
    return {
      ...row,
      categoryId,
      initialCategoryId: categoryId,
      source: 'jev',
      choices,
    }
  })
}

async function processCalibration(runId: string) {
  const run = await prisma.bulkCategorizationRun.findUniqueOrThrow({
    where: { id: runId },
  })
  if (!['QUEUED_CALIBRATION', 'CALIBRATING'].includes(run.status)) return
  const calibration = calibrationOf(run.calibration)
  const candidates = list<Candidate>(run.candidates)
  const sample = calibration.sample.length
    ? calibration.sample
    : await suggestRows(
        run,
        sampleCalibrationCandidates(
          candidates,
          new Set(calibration.confirmed.map((row) => row.id)),
        ),
        calibration.confirmed,
      )
  calibration.sample = sample
  await prisma.bulkCategorizationRun.update({
    where: { id: runId },
    data: {
      status: 'CALIBRATION_REVIEW',
      round: run.round + (run.status === 'QUEUED_CALIBRATION' ? 1 : 0),
      calibration: json(calibration),
      processed: 0,
      total: sample.length,
    },
  })
}

async function processFull(runId: string) {
  let run = await prisma.bulkCategorizationRun.findUniqueOrThrow({
    where: { id: runId },
  })
  if (!['QUEUED', 'PROCESSING'].includes(run.status)) return
  const calibration = calibrationOf(run.calibration)
  const confirmedIds = new Set(calibration.confirmed.map((row) => row.id))
  const candidates = list<Candidate>(run.candidates).filter(
    (row) => !confirmedIds.has(row.id),
  )
  let state = fullPassStateOf(run.examples)
  if (!state) {
    while (run.processed < candidates.length) {
      const chunk = candidates.slice(run.processed, run.processed + 25)
      const additions = await suggestRows(run, chunk, calibration.confirmed)
      run = await prisma.bulkCategorizationRun.update({
        where: { id: runId },
        data: {
          status: 'PROCESSING',
          processed: run.processed + chunk.length,
          suggestions: json([
            ...list<Suggestion>(run.suggestions),
            ...additions,
          ]),
        },
      })
    }
    if (run.mode !== 'jev') {
      await prisma.bulkCategorizationRun.update({
        where: { id: runId },
        data: { status: 'REVIEW' },
      })
      return
    }
    const candidateIds = new Set(candidates.map((row) => row.id))
    const targetIds = getAutomaticJevTargets(
      list<Suggestion>(run.suggestions).filter((row) =>
        candidateIds.has(row.id),
      ),
    ).map((row) => row.id)
    state = { phase: 'second', targetIds }
    run = await prisma.bulkCategorizationRun.update({
      where: { id: runId },
      data: {
        examples: json(state),
        processed: 0,
        total: targetIds.length,
        status: 'PROCESSING',
      },
    })
  }
  if (state.phase === 'second') {
    const byId = new Map(candidates.map((row) => [row.id, row]))
    const targets = state.targetIds.map((id) => {
      const candidate = byId.get(id)
      if (!candidate) throw new Error(`Second-pass candidate ${id} is missing`)
      return candidate
    })
    while (run.processed < targets.length) {
      const chunk = targets.slice(run.processed, run.processed + 25)
      const additions = await suggestRows(run, chunk, calibration.confirmed, {
        dateNeighbors: true,
      })
      run = await prisma.bulkCategorizationRun.update({
        where: { id: runId },
        data: {
          status: 'PROCESSING',
          processed: run.processed + chunk.length,
          suggestions: json(
            mergeAutomaticJevSuggestions(
              list<Suggestion>(run.suggestions),
              additions,
            ),
          ),
        },
      })
    }
  }
  await prisma.bulkCategorizationRun.update({
    where: { id: runId },
    data: { status: 'REVIEW', examples: json({ ...state, phase: 'complete' }) },
  })
}

async function processRerun(runId: string) {
  let run = await prisma.bulkCategorizationRun.findUniqueOrThrow({
    where: { id: runId },
  })
  if (!['QUEUED_RERUN', 'RERUNNING'].includes(run.status)) return
  const calibration = calibrationOf(run.calibration)
  const feedback = finalReviewCorrections(
    list<Suggestion>(run.suggestions),
    calibration,
  )
  const candidates = getRerunTargetCandidates(
    list<Candidate>(run.candidates),
    list<Suggestion>(run.suggestions),
    calibration,
  )
  const confirmedById = new Map(
    calibration.confirmed.map((row) => [row.id, row]),
  )
  const examples = [
    ...calibration.confirmed,
    ...feedback.filter((row) => !confirmedById.has(row.id)),
  ]
  if (run.processed >= candidates.length)
    run = await prisma.bulkCategorizationRun.update({
      where: { id: runId },
      data: { processed: 0, total: candidates.length },
    })
  while (run.processed < candidates.length) {
    const chunk = candidates.slice(run.processed, run.processed + 25)
    const additions = await suggestRows(run, chunk, examples)
    const suggestions = mergeRerunSuggestions(
      list<Suggestion>(run.suggestions),
      additions,
    )
    run = await prisma.bulkCategorizationRun.update({
      where: { id: runId },
      data: {
        status: 'RERUNNING',
        processed: run.processed + chunk.length,
        suggestions: json(suggestions),
      },
    })
  }
  await prisma.bulkCategorizationRun.update({
    where: { id: runId },
    data: { status: 'REVIEW', processed: 0, total: candidates.length },
  })
}

export function mergeRerunSuggestions(
  current: Suggestion[],
  additions: Suggestion[],
) {
  const additionsById = new Map(additions.map((row) => [row.id, row]))
  return current.map((row) => {
    const addition = additionsById.get(row.id)
    return addition
      ? {
          ...addition,
          firstPass: row.firstPass,
          secondPass: row.secondPass,
        }
      : row
  })
}

async function processApply(runId: string) {
  let run = await prisma.bulkCategorizationRun.findUniqueOrThrow({
    where: { id: runId },
  })
  if (run.status !== 'APPLYING') return
  const selected = list<Suggestion>(run.suggestions).filter(
    (row) => row.categoryId !== DEFAULT_CATEGORY_ID && row.included !== false,
  )
  while (run.processed < selected.length) {
    const chunk = selected.slice(run.processed, run.processed + 500)
    const current = await prisma.expense.findMany({
      where: {
        id: { in: chunk.map((row) => row.id) },
        categoryId: DEFAULT_CATEGORY_ID,
      },
      select: { id: true, version: true },
    })
    const versions = new Map(current.map((row) => [row.id, row.version]))
    const eligible = chunk.filter((row) => versions.get(row.id) === row.version)
    const result = eligible.length
      ? await bulkUpdateExpenseCategories({
          groupId: run.groupId,
          accountId: run.accountId,
          input: {
            groupId: run.groupId,
            fromCategoryId: DEFAULT_CATEGORY_ID,
            changes: eligible.map((row) => ({
              expenseId: row.id,
              categoryId: row.categoryId,
            })),
          },
        })
      : { applied: 0, skipped: 0 }
    run = await prisma.bulkCategorizationRun.update({
      where: { id: runId },
      data: {
        processed: run.processed + chunk.length,
        applied: run.applied + result.applied,
        skipped: run.skipped + result.skipped + chunk.length - eligible.length,
      },
    })
  }
  if (run.applied > 0) await enqueueBudgetEvaluation(run.groupId)
  await prisma.bulkCategorizationRun.update({
    where: { id: runId },
    data: { status: 'DONE' },
  })
}

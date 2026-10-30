import { prisma, type Prisma } from '@spliit/db'
import {
  DEFAULT_CATEGORY_ID,
  SETTLEMENT_CATEGORY_ID,
  createCategorySearchDocumentsForLocale,
  loadLocaleDictionary,
  type CategoryId,
} from '@spliit/domain'

import type {
  SystemOneExpense,
  SystemOneNeighbor,
} from '../ai/batch-categorize'
import { getRecentExpenseContext } from '../ai/context'
import { loadSystemOneDateNeighbors } from '../ai/system-one-neighbors'
import { enqueueBudgetEvaluation } from '../budgets/enqueue'
import { env } from '../env'
import { getPersonalExpenseContext } from '../personal/category-suggest'
import { ensurePersonalProfile } from '../personal/profile'
import type { Candidate } from './bulk-categorization-run'
import { bulkUpdateExpenseCategories } from './category-bulk'
import { randomId } from './shared'

export type BulkScopeType = 'GROUP' | 'PERSONAL'
export type BulkScope = { scopeType: BulkScopeType; scopeId: string }
export type SaveConflict = { expenseId: string; title: string }

type LocalContext = Awaited<ReturnType<typeof getRecentExpenseContext>>

export interface BulkCategorizationTarget {
  scope: BulkScope
  /** Legacy group id for group runs; null for personal runs. */
  groupId: string | null
  supportsSeries: boolean
  countUncategorized(): Promise<number>
  captureCandidates(): Promise<{
    count: number
    candidates: Candidate[]
    existingCategorized: number
  }>
  findConflicts(
    tx: Prisma.TransactionClient,
    selected: Array<{
      itemId: string
      title: string
      expenseVersion: number
      recurringSeriesId: string | null
    }>,
  ): Promise<SaveConflict[]>
  applyChunk(
    tx: Prisma.TransactionClient,
    args: {
      accountId: string
      changes: Array<{ itemId: string; categoryId: CategoryId }>
      expectedVersions: Map<string, number>
      seriesScopes?: Record<
        string,
        'SELECTED' | 'THIS_AND_FUTURE' | 'WHOLE_SERIES'
      >
    },
  ): Promise<number>
  afterApply(applied: number): Promise<void>
  loadLocalContext(locale: string): Promise<{
    context: LocalContext
    documents: ReturnType<typeof createCategorySearchDocumentsForLocale>
  }>
  loadDateNeighbors?(
    targets: readonly SystemOneExpense[],
    confirmed: readonly (SystemOneNeighbor & { id: string })[],
  ): Promise<Map<string, SystemOneNeighbor[]>>
}

const RUN_LIMIT = 10_000

export function groupTarget(groupId: string): BulkCategorizationTarget {
  return {
    scope: { scopeType: 'GROUP', scopeId: groupId },
    groupId,
    supportsSeries: true,
    async countUncategorized() {
      const group = await prisma.group.findUniqueOrThrow({
        where: { id: groupId },
        select: { ledgerId: true },
      })
      return prisma.expense.count({
        where: { ledgerId: group.ledgerId, categoryId: DEFAULT_CATEGORY_ID },
      })
    },
    async captureCandidates() {
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
          recurringSeriesId: string | null
          recurrenceSequence: number | null
        }>
      >`
        WITH ranked AS (
          SELECT "id", "title", "version", "expenseDate", "amount", "recurringSeriesId", "recurrenceSequence",
            row_number() OVER (ORDER BY "expenseDate", "id") - 1 AS ordinal
          FROM "Expense"
          WHERE "ledgerId" = ${group.ledgerId} AND "categoryId" = ${DEFAULT_CATEGORY_ID}
        ), bucketed AS (
          SELECT *, floor(ordinal * ${Math.min(count, RUN_LIMIT)}::numeric / ${Math.max(count, 1)})::integer AS bucket
          FROM ranked
        )
        SELECT DISTINCT ON (bucket) "id", "title", "version", "expenseDate", "amount", "recurringSeriesId", "recurrenceSequence"
        FROM bucketed ORDER BY bucket, ordinal`
      const candidates = rows.slice(0, RUN_LIMIT).map((row): Candidate => ({
        id: row.id,
        title: row.title,
        version: row.version,
        expenseDate: row.expenseDate.toISOString(),
        amount: row.amount,
        currency: ledger.currencyCode ?? ledger.currency,
        recurringSeriesId: row.recurringSeriesId,
        recurrenceSequence: row.recurrenceSequence,
      }))
      const existingCategorized = await prisma.expense.count({
        where: {
          ledgerId: group.ledgerId,
          categoryId: { notIn: [DEFAULT_CATEGORY_ID, SETTLEMENT_CATEGORY_ID] },
        },
      })
      return { count, candidates, existingCategorized }
    },
    async findConflicts(tx, selected) {
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
              in: selected.slice(offset, offset + 1000).map((r) => r.itemId),
            },
          },
          select: {
            id: true,
            version: true,
            categoryId: true,
            recurringSeriesId: true,
          },
        })
        for (const e of expenses) live.set(e.id, e)
      }
      const rowConflicts = selected
        .filter((row) => {
          const expense = live.get(row.itemId)
          return (
            !expense ||
            expense.categoryId !== DEFAULT_CATEGORY_ID ||
            expense.version !== row.expenseVersion
          )
        })
        .map((row) => ({ expenseId: row.itemId, title: row.title }))
      if (rowConflicts.length > 0) return rowConflicts
      const seriesIds = [
        ...new Set(
          selected
            .map((r) => r.recurringSeriesId)
            .filter((id): id is string => id != null),
        ),
      ]
      if (seriesIds.length === 0) return []
      const seriesRows = await tx.recurringExpenseSeries.findMany({
        where: { id: { in: seriesIds } },
        select: { id: true, templateVersion: true, template: true },
      })
      const liveSeries = new Map(seriesRows.map((s) => [s.id, s]))
      const seriesConflicts: SaveConflict[] = []
      for (const row of selected) {
        if (!row.recurringSeriesId) continue
        const liveRow = liveSeries.get(row.recurringSeriesId)
        if (!liveRow) {
          seriesConflicts.push({ expenseId: row.itemId, title: row.title })
          break
        }
        const template = liveRow.template as unknown as { categoryId?: unknown }
        if (
          typeof template.categoryId === 'string' &&
          template.categoryId !== DEFAULT_CATEGORY_ID
        ) {
          seriesConflicts.push({ expenseId: row.itemId, title: row.title })
          break
        }
      }
      return seriesConflicts
    },
    async applyChunk(tx, args) {
      const expectedVersions = args.expectedVersions
      const touchedSeriesIds = [
        ...new Set(
          args.changes
            .map((c) => {
              return (c as { recurringSeriesId?: string | null })
                .recurringSeriesId
            })
            .filter((id): id is string => id != null),
        ),
      ]
      // NOTE: recurringSeriesId is resolved by the caller from run rows; the
      // changes payload itself carries only itemId/categoryId. Series snapshots
      // are claimed by the run-level apply which passes template versions via
      // expectedVersions (`series:<id>` keys).
      void touchedSeriesIds
      const update = await bulkUpdateExpenseCategories({
        groupId,
        accountId: args.accountId,
        transaction: tx,
        expectedVersions,
        setBased: true,
        input: {
          groupId,
          fromCategoryId: DEFAULT_CATEGORY_ID,
          seriesScopes: args.seriesScopes ?? {},
          changes: args.changes.map((c) => ({
            expenseId: c.itemId,
            categoryId: c.categoryId,
          })),
        },
      })
      return update.applied
    },
    async afterApply(applied) {
      if (applied > 0) await enqueueBudgetEvaluation(groupId)
    },
    async loadLocalContext(locale) {
      await loadLocaleDictionary(locale)
      return {
        context: await getRecentExpenseContext(
          groupId,
          env.CATEGORY_MEMORY_LIMIT,
        ),
        documents: createCategorySearchDocumentsForLocale(locale),
      }
    },
    async loadDateNeighbors(targets, confirmed) {
      return loadSystemOneDateNeighbors(groupId, targets, confirmed)
    },
  }
}

export function personalTarget(accountId: string): BulkCategorizationTarget {
  return {
    scope: { scopeType: 'PERSONAL', scopeId: accountId },
    groupId: null,
    supportsSeries: false,
    async countUncategorized() {
      const profile = await ensurePersonalProfile(accountId)
      const counted = await prisma.$queryRaw<Array<{ count: number }>>`
        SELECT COUNT(*)::int AS count
        FROM "PersonalTransaction"
        WHERE "accountId" = ${accountId}
          AND "kind" = 'EXPENSE'
          AND "categoryId" = ${DEFAULT_CATEGORY_ID}
          AND NULLIF(btrim("title"), '') IS NOT NULL
          AND (${profile.sharedEnabled} OR "source" = 'PERSONAL')
      `
      return counted[0]?.count ?? 0
    },
    async captureCandidates() {
      const profile = await ensurePersonalProfile(accountId)
      const where = {
        accountId,
        kind: 'EXPENSE' as const,
        categoryId: DEFAULT_CATEGORY_ID,
        title: { not: null },
        ...(profile.sharedEnabled ? {} : { source: 'PERSONAL' as const }),
      }
      const [counted, existingCategorized] = await Promise.all([
        prisma.$queryRaw<Array<{ count: number }>>`
          SELECT COUNT(*)::int AS count
          FROM "PersonalTransaction"
          WHERE "accountId" = ${accountId}
            AND "kind" = 'EXPENSE'
            AND "categoryId" = ${DEFAULT_CATEGORY_ID}
            AND NULLIF(btrim("title"), '') IS NOT NULL
            AND (${profile.sharedEnabled} OR "source" = 'PERSONAL')
        `,
        prisma.personalTransaction.count({
          where: {
            accountId,
            kind: 'EXPENSE',
            categoryId: {
              notIn: [DEFAULT_CATEGORY_ID, SETTLEMENT_CATEGORY_ID],
            },
            ...(profile.sharedEnabled ? {} : { source: 'PERSONAL' as const }),
          },
        }),
      ])
      // Keep the Prisma `where` above for the visible-source gate; the
      // authoritative uncategorized count excludes empty/whitespace titles via
      // NULLIF(btrim(...)) so it matches the capture query below.
      void where
      const count = counted[0]?.count ?? 0
      const existingCategorizedCount = existingCategorized
      // Stratified bucket sample mirroring the group capture (date-ordered,
      // evenly spread, capped at RUN_LIMIT) so large personal ledgers get a
      // representative calibration slice with identical limit semantics.
      const total = count
      const rows = await prisma.$queryRaw<
        Array<{
          id: string
          title: string
          version: number
          date: Date
          amount: number
        }>
      >`
        WITH ranked AS (
          SELECT "id", "title", "version", "date", "amount",
            row_number() OVER (ORDER BY "date", "id") - 1 AS ordinal
          FROM "PersonalTransaction"
          WHERE "accountId" = ${accountId}
            AND "kind" = 'EXPENSE'
            AND "categoryId" = ${DEFAULT_CATEGORY_ID}
            AND NULLIF(btrim("title"), '') IS NOT NULL
            AND (${profile.sharedEnabled} OR "source" = 'PERSONAL')
        ), bucketed AS (
          SELECT *, floor(ordinal * ${Math.min(total, RUN_LIMIT)}::numeric / ${Math.max(total, 1)})::integer AS bucket
          FROM ranked
        )
        SELECT DISTINCT ON (bucket) "id", "title", "version", "date", "amount"
        FROM bucketed ORDER BY bucket, ordinal`
      const candidates = rows.slice(0, RUN_LIMIT).map((row): Candidate => ({
        id: row.id,
        title: row.title,
        version: row.version,
        expenseDate: row.date.toISOString(),
        amount: row.amount,
        currency: profile.currencyCode,
      }))
      return {
        count,
        candidates,
        existingCategorized: existingCategorizedCount,
      }
    },
    async findConflicts(tx, selected) {
      if (!selected.length) return []
      const conflicts: SaveConflict[] = []
      for (let offset = 0; offset < selected.length; offset += 500) {
        const chunk = selected.slice(offset, offset + 500)
        const live = await tx.personalTransaction.findMany({
          where: { accountId, id: { in: chunk.map((r) => r.itemId) } },
          select: {
            id: true,
            version: true,
            categoryId: true,
            title: true,
            source: true,
            sourceExpenseId: true,
            sourceDetachedAt: true,
          },
        })
        const byId = new Map(live.map((r) => [r.id, r]))
        const linkedSourceIds = [
          ...new Set(
            live
              .filter(
                (row) =>
                  row.source === 'GROUP' &&
                  !row.sourceDetachedAt &&
                  row.sourceExpenseId,
              )
              .map((row) => row.sourceExpenseId as string),
          ),
        ]
        const existingSourceIds =
          linkedSourceIds.length > 0
            ? new Set(
                (
                  await tx.expense.findMany({
                    where: { id: { in: linkedSourceIds } },
                    select: { id: true },
                  })
                ).map((row) => row.id),
              )
            : new Set<string>()
        for (const row of chunk) {
          const current = byId.get(row.itemId)
          if (
            !current ||
            current.version !== row.expenseVersion ||
            current.categoryId !== DEFAULT_CATEGORY_ID
          ) {
            conflicts.push({ expenseId: row.itemId, title: row.title })
            continue
          }
          if (
            current.source === 'GROUP' &&
            !current.sourceDetachedAt &&
            current.sourceExpenseId &&
            !existingSourceIds.has(current.sourceExpenseId)
          ) {
            conflicts.push({ expenseId: row.itemId, title: row.title })
          }
        }
      }
      return conflicts
    },
    async applyChunk(tx, args) {
      let applied = 0
      // Load sources to split PERSONAL/detached (row-only) from live GROUP
      // (row + override). Detached snapshots have no live group row to
      // override, so they apply like PERSONAL rows.
      // NOTE: the per-row version-checked updateMany + override upsert below
      // is intentional — each row needs its own CAS guard and live GROUP rows
      // need a paired override write, so this cannot be a single set-based
      // update without losing per-row conflict semantics.
      const rows = await tx.personalTransaction.findMany({
        where: { accountId, id: { in: args.changes.map((c) => c.itemId) } },
        select: {
          id: true,
          version: true,
          source: true,
          sourceExpenseId: true,
          sourceDetachedAt: true,
          categoryId: true,
        },
      })
      const byId = new Map(rows.map((r) => [r.id, r]))
      for (const change of args.changes) {
        const live = byId.get(change.itemId)
        if (!live)
          throw new Error(
            'An entry changed while saving. No categories were applied; review the changed entries and try again.',
          )
        const expected = args.expectedVersions.get(change.itemId)
        if (expected !== undefined && live.version !== expected) {
          throw new Error(
            'An entry changed while saving. No categories were applied; review the changed entries and try again.',
          )
        }
        if (live.categoryId !== DEFAULT_CATEGORY_ID) {
          throw new Error(
            'An entry changed while saving. No categories were applied; review the changed entries and try again.',
          )
        }
        const isLiveGroup =
          live.source === 'GROUP' &&
          !live.sourceDetachedAt &&
          live.sourceExpenseId
        if (!isLiveGroup) {
          const claimed = await tx.personalTransaction.updateMany({
            where: {
              id: change.itemId,
              accountId,
              version: live.version,
              categoryId: DEFAULT_CATEGORY_ID,
            },
            data: { categoryId: change.categoryId, version: { increment: 1 } },
          })
          if (claimed.count !== 1) {
            throw new Error(
              'An entry changed while saving. No categories were applied; review the changed entries and try again.',
            )
          }
          applied += 1
        } else {
          const claimed = await tx.personalTransaction.updateMany({
            where: {
              id: change.itemId,
              accountId,
              version: live.version,
              categoryId: DEFAULT_CATEGORY_ID,
            },
            data: { categoryId: change.categoryId, version: { increment: 1 } },
          })
          if (claimed.count !== 1) {
            throw new Error(
              'An entry changed while saving. No categories were applied; review the changed entries and try again.',
            )
          }
          await tx.personalExpenseOverride.upsert({
            where: {
              accountId_expenseId: {
                accountId,
                expenseId: live.sourceExpenseId!,
              },
            },
            create: {
              id: randomId(),
              accountId,
              expenseId: live.sourceExpenseId!,
              categoryId: change.categoryId,
            },
            update: { categoryId: change.categoryId },
          })
          applied += 1
        }
      }
      return applied
    },
    async afterApply() {
      // Personal budgets are read-computed; no enqueue.
    },
    async loadLocalContext(locale) {
      await loadLocaleDictionary(locale)
      const context = await getPersonalExpenseContext(
        accountId,
        env.CATEGORY_MEMORY_LIMIT,
      )
      return {
        context,
        documents: createCategorySearchDocumentsForLocale(locale),
      }
    },
  }
}

export function targetForScope(
  scopeType: string,
  scopeId: string,
): BulkCategorizationTarget {
  if (scopeType === 'PERSONAL') return personalTarget(scopeId)
  return groupTarget(scopeId)
}

export function scopeForRun(run: {
  scopeType: string | null
  scopeId: string | null
  groupId: string | null
}): BulkScope {
  if (run.scopeType === 'PERSONAL' && run.scopeId) {
    return { scopeType: 'PERSONAL', scopeId: run.scopeId }
  }
  // Legacy rows backfilled to GROUP/scopeId=groupId; fall back to groupId.
  return { scopeType: 'GROUP', scopeId: run.scopeId || run.groupId || '' }
}

import { prisma, Prisma } from '@spliit/db'
import {
  BULK_APPLY_HARD_LIMIT,
  DEFAULT_CATEGORY_ID,
  SETTLEMENT_CATEGORY_ID,
  categoryIdSchema,
  type BulkCategorySeriesScope,
  type CategoryId,
  type ExpenseCategoriesBulkUpdatedActivityData,
  type ExpenseCategoriesBulkUpdatedRow,
  type RecurringExpenseTemplate,
} from '@spliit/domain'
import type { BulkUpdateExpenseCategoriesInput } from '@spliit/domain/schemas'

import {
  hasEligibleWebhookEndpoints,
  planExpenseBatchWebhook,
} from '../webhooks/planner'
import { loadExpenseSnapshotsChunked } from '../webhooks/snapshot'
import { logActivity, planNotificationForActivity } from './activities'
import { getApiBoss } from './boss'
import { groupLedgerIdArchivedSelect } from './selects/group-ledger-id-archived'

/**
 * Re-export the hard limit for backwards-compatible call sites that imported it
 * from `apps/api/src/lib/api/category-bulk`.
 */
export { BULK_APPLY_HARD_LIMIT }

export type BulkCategorizeApplyResult = {
  /** Number of expenses whose category was actually changed. */
  applied: number
  /**
   * Number of expenses whose stored category already matched the request
   * (skipped).
   */
  skipped: number
  /** Number of distinct destination categories applied. */
  distinctCategories: number
  /**
   * Per-row before/after for the activity row. Capped at 2000 by the input
   * schema.
   */
  rows: ExpenseCategoriesBulkUpdatedRow[]
  /**
   * Per-series template propagations applied alongside the rows. Only
   * non-SELECTED scopes appear here; SELECTED-only edits leave the template
   * untouched (and the series reads as diverged until propagated).
   */
  seriesUpdated: Array<{
    seriesId: string
    propagation: 'THIS_AND_FUTURE' | 'WHOLE_SERIES'
    occurrenceCount: number
    templateChanged: boolean
    toCategoryId: CategoryId
  }>
  /** Distinct series ids touched by the applied rows (any scope). */
  touchedSeriesIds: string[]
}

/**
 * Bulk-apply category edits across many expenses in one transaction.
 *
 * Validations:
 *
 * - Every `change.expenseId` must belong to the target group
 * - The row must currently sit on `fromCategoryId` (default "general") AND not be
 *   a settlement row
 * - Everything else (the destination `categoryId`) is enforced by Zod upstream
 * - One series gets at most one destination category per batch, and at most one
 *   propagation scope; conflicts fail the whole batch so a partial template
 *   rewrite can never diverge a series silently.
 *
 * Propagation (`input.seriesScopes`, default `SELECTED`):
 *
 * - `SELECTED` updates only the chosen occurrences. The series template is left
 *   untouched, so the series reads as diverged until a later propagate edit
 *   rewrites the template.
 * - `THIS_AND_FUTURE` rewrites the series template plus the selected rows and
 *   every occurrence at/after the earliest selected sequence, converging
 *   already-diverged rows to the same destination.
 * - `WHOLE_SERIES` rewrites the series template plus every materialized
 *   occurrence of the series, including rows that previously diverged.
 *
 * Occurrence counts in `seriesUpdated` therefore include healed diverged rows,
 * not just rows that moved off `fromCategoryId` in this batch.
 *
 * Series template writes are version-checked (`templateVersion`) under a row
 * lock; a concurrent template change fails the whole batch.
 *
 * After the update we log a single `EXPENSE_CATEGORIES_BULK_UPDATED` activity
 * row carrying the per-expense before/after so the activity feed / drawer can
 * render the affected rows without an extra round-trip.
 *
 * This helper is intentionally narrow: it only mutates `categoryId`. Amounts,
 * splits, dates, recurrence, etc. stay untouched; callers that need to touch
 * those should still go through `updateExpense`.
 */
export async function bulkUpdateExpenseCategories(args: {
  groupId: string
  /** Authenticated account id, persisted as the activity actor. */
  accountId: string
  input: BulkUpdateExpenseCategoriesInput
  /** Join a caller's all-or-nothing transaction when supplied. */
  transaction?: Prisma.TransactionClient
  /** Expected expense versions. A mismatch is reported as a skipped row. */
  expectedVersions?: Map<string, number>
  /** Use one version-checked SQL update for a large reviewed run. */
  setBased?: boolean
}): Promise<BulkCategorizeApplyResult> {
  const { groupId, accountId, input, expectedVersions } = args
  const fromCategoryId = input.fromCategoryId ?? DEFAULT_CATEGORY_ID
  const seriesScopes = input.seriesScopes ?? {}

  if (input.changes.length === 0) {
    return {
      applied: 0,
      skipped: 0,
      distinctCategories: 0,
      rows: [],
      seriesUpdated: [],
      touchedSeriesIds: [],
    }
  }
  if (input.changes.length > BULK_APPLY_HARD_LIMIT) {
    throw new Error(
      `bulkUpdateExpenseCategories received ${input.changes.length} changes (max ${BULK_APPLY_HARD_LIMIT})`,
    )
  }

  // De-duplicate ids so a same-row duplicate doesn't update twice.
  const wantedById = new Map<string, string>()
  for (const change of input.changes) {
    wantedById.set(change.expenseId, change.categoryId)
  }

  const client = args.transaction ?? prisma
  const group = await client.group.findUnique({
    where: { id: groupId },
    select: groupLedgerIdArchivedSelect,
  })
  if (!group) {
    throw new Error(`Group not found: ${groupId}`)
  }
  if (group.archived) {
    throw new Error('Cannot bulk-update categories on an archived group')
  }

  if (
    fromCategoryId === SETTLEMENT_CATEGORY_ID ||
    Array.from(wantedById.values()).some(
      (categoryId) => categoryId === SETTLEMENT_CATEGORY_ID,
    )
  ) {
    throw new Error('Cannot bulk-apply the settlement category')
  }

  const boss = await getApiBoss()
  const apply = async (tx: Prisma.TransactionClient) => {
    // Read eligible rows for the activity record. The update below checks
    // each row's category and version, so a concurrent change is skipped.
    // Series membership rides along so propagation scopes can group rows
    // without a second round-trip.
    const candidates = await tx.expense.findMany({
      where: {
        ledgerId: group.ledgerId,
        id: { in: Array.from(wantedById.keys()) },
        categoryId: fromCategoryId,
      },
      select: {
        id: true,
        title: true,
        categoryId: true,
        version: true,
        recurringSeriesId: true,
        recurrenceSequence: true,
      },
    })

    if (candidates.length === 0) {
      // Nothing eligible (every requested row either doesn't belong
      // to this group, is a settlement, or already has the
      // destination category). Surface every requested expenseId as
      // skipped so the caller's accounting is correct.
      return {
        applied: 0,
        skipped: wantedById.size,
        distinctCategories: 0,
        rows: [],
        seriesUpdated: [],
        touchedSeriesIds: [],
      } satisfies BulkCategorizeApplyResult
    }

    // Group eligible candidates by series to resolve propagation scopes.
    // Conflict detection (two destinations or two scopes for one series)
    // runs over every requested row of the series — not just the rows still
    // eligible for a category move. Requested rows carry their *requested*
    // destination via `wantedById`, so a no-op row (already on the
    // destination, already moved by a concurrent edit) still anchors the
    // series' single destination; mixing it with a different live
    // destination rejects instead of rewriting the template to one
    // category while occurrences claim two.
    //
    // The eligible-candidate filter below cannot see this: it is
    // pre-filtered to `categoryId = from`, so an already-diverged row drops
    // out and a cross-destination batch would look single-destination.
    // Requested rows without any membership load (deleted, cross-ledger)
    // are ignored — they move nothing and select no template category.
    const scopeBySeriesId = new Map<string, BulkCategorySeriesScope>()
    const destinationBySeriesId = new Map<string, string>()
    const anchorSequenceBySeriesId = new Map<string, number>()
    const memberSequenceBySeriesId = new Map<string, number[]>()
    {
      // Membership for every requested row (not just the `from`-filtered
      // candidates), so conflict detection sees the whole batch.
      const membership = await tx.expense.findMany({
        where: {
          ledgerId: group.ledgerId,
          id: { in: Array.from(wantedById.keys()) },
          recurringSeriesId: { not: null },
        },
        select: {
          id: true,
          recurringSeriesId: true,
          recurrenceSequence: true,
        },
      })
      for (const member of membership) {
        if (!member.recurringSeriesId) continue
        const destination = wantedById.get(member.id)
        if (!destination) continue
        const seriesId = member.recurringSeriesId
        const scope = seriesScopes[seriesId] ?? 'SELECTED'
        const seenScope = scopeBySeriesId.get(seriesId)
        if (seenScope && seenScope !== scope) {
          throw new Error(
            'Conflicting bulk propagation scopes for one recurring series',
          )
        }
        scopeBySeriesId.set(seriesId, scope)
        const seenDestination = destinationBySeriesId.get(seriesId)
        if (seenDestination && seenDestination !== destination) {
          throw new Error(
            'Conflicting bulk categories for one recurring series',
          )
        }
        destinationBySeriesId.set(seriesId, destination)
        const list = memberSequenceBySeriesId.get(seriesId) ?? []
        if (member.recurrenceSequence != null)
          list.push(member.recurrenceSequence)
        memberSequenceBySeriesId.set(seriesId, list)
      }
      for (const [seriesId, sequences] of memberSequenceBySeriesId) {
        if (sequences.length > 0) {
          anchorSequenceBySeriesId.set(seriesId, Math.min(...sequences))
        }
      }
    }

    // Lock every touched series up front and snapshot template versions so
    // a concurrent series edit fails the whole batch instead of diverging
    // occurrences from the template mid-write.
    const seriesSnapshots = new Map<
      string,
      { templateVersion: number; template: RecurringExpenseTemplate }
    >()
    for (const seriesId of scopeBySeriesId.keys()) {
      await tx.$queryRaw`SELECT id FROM "RecurringExpenseSeries" WHERE id = ${seriesId} FOR UPDATE`
      const series = await tx.recurringExpenseSeries.findUnique({
        where: { id: seriesId },
        select: { ledgerId: true, templateVersion: true, template: true },
      })
      if (!series || series.ledgerId !== group.ledgerId) {
        throw new Error(`Recurring series not found: ${seriesId}`)
      }
      seriesSnapshots.set(seriesId, {
        templateVersion: series.templateVersion,
        template: series.template as unknown as RecurringExpenseTemplate,
      })
    }
    if (expectedVersions) {
      for (const [seriesId, snapshot] of seriesSnapshots) {
        const expected = (expectedVersions as Map<string, number>).get(
          `series:${seriesId}`,
        )
        if (expected !== undefined && snapshot.templateVersion !== expected) {
          throw new Error(
            'Recurring expense series changed while it was being updated; retry the update',
          )
        }
      }
    }

    const rows: ExpenseCategoriesBulkUpdatedRow[] = []
    const distinctDestinations = new Set<string>()
    // Expense ids whose category actually moved (set-based path returns only
    // claimed rows; the row loop skips no-ops up front).
    const movedIds = new Set<string>()
    const candidateById = new Map(candidates.map((c) => [c.id, c]))

    if (args.setBased) {
      if (!expectedVersions)
        throw new Error('Set-based category updates require expense versions')
      const values = candidates.map(
        (candidate) =>
          Prisma.sql`(${candidate.id}::text, ${expectedVersions.get(candidate.id) ?? -1}::integer, ${wantedById.get(candidate.id) ?? ''}::text)`,
      )
      const updated = await tx.$queryRaw<
        Array<{ id: string; title: string; categoryId: string }>
      >(Prisma.sql`
        UPDATE "Expense" AS expense
        SET "categoryId" = desired."categoryId", "version" = expense."version" + 1
        FROM (VALUES ${Prisma.join(values)}) AS desired("id", "version", "categoryId")
        WHERE expense."id" = desired."id"
          AND expense."ledgerId" = ${group.ledgerId}
          AND expense."categoryId" = ${fromCategoryId}
          AND expense."version" = desired."version"
        RETURNING expense."id", expense."title", expense."categoryId"
      `)
      for (const changed of updated) {
        // Skip rows that already sat on the destination: the version-checked
        // update above cannot distinguish them, but they must not count as
        // applied nor drive template propagation.
        if (changed.categoryId === fromCategoryId) continue
        rows.push({
          expenseId: changed.id,
          title: changed.title,
          fromCategoryId: fromCategoryId as CategoryId,
          toCategoryId: changed.categoryId as CategoryId,
          ...(candidateById.get(changed.id)?.recurringSeriesId
            ? {
                recurringSeriesId: candidateById.get(changed.id)!
                  .recurringSeriesId!,
                propagation: 'SELECTED' as const,
              }
            : {}),
        })
        movedIds.add(changed.id)
        distinctDestinations.add(changed.categoryId)
      }
    } else
      for (const candidate of candidates) {
        const toCategoryId = wantedById.get(candidate.id)
        if (!toCategoryId) continue
        const expectedVersion = expectedVersions?.get(candidate.id)
        if (
          expectedVersions &&
          (expectedVersion === undefined ||
            candidate.version !== expectedVersion)
        )
          continue
        // Narrow via the schema in case the stored category is a
        // legacy/unknown id; this just protects the activity row from
        // crashing on weird inputs.
        const from: CategoryId = categoryIdSchema.safeParse(
          candidate.categoryId,
        ).success
          ? (candidate.categoryId as CategoryId)
          : DEFAULT_CATEGORY_ID
        if (from === toCategoryId) continue
        const claimed = await tx.expense.updateMany({
          where: {
            id: candidate.id,
            ledgerId: group.ledgerId,
            categoryId: candidate.categoryId,
            version: expectedVersion ?? candidate.version,
          },
          data: {
            categoryId: toCategoryId,
            version: { increment: 1 },
          },
        })
        if (claimed.count === 0) continue
        rows.push({
          expenseId: candidate.id,
          title: candidate.title,
          fromCategoryId: from,
          toCategoryId: toCategoryId as CategoryId,
          ...(candidate.recurringSeriesId
            ? {
                recurringSeriesId: candidate.recurringSeriesId,
                propagation: 'SELECTED' as const,
              }
            : {}),
        })
        movedIds.add(candidate.id)
        distinctDestinations.add(toCategoryId)
      }

    // No row was actually moved (every requested expense was already
    // on the destination category, or no candidates matched the
    // eligibility filter).
    if (rows.length === 0) {
      const skipped = candidates.length + (wantedById.size - candidates.length)
      return {
        applied: 0,
        skipped,
        distinctCategories: 0,
        rows: [],
        seriesUpdated: [],
        touchedSeriesIds: [...scopeBySeriesId.keys()],
      } satisfies BulkCategorizeApplyResult
    }

    // Propagation: for non-SELECTED series scopes, rewrite the template and
    // converge every sibling occurrence of the series — including rows that
    // already diverged from the template before this batch. The per-row
    // updates above already moved the selected rows still on `from`;
    // the sibling sweep below heals the rest to the same destination, so a
    // whole-series save always leaves the series converged.
    const seriesUpdated: BulkCategorizeApplyResult['seriesUpdated'] = []
    for (const [seriesId, scope] of scopeBySeriesId) {
      if (scope === 'SELECTED') continue
      const destination = destinationBySeriesId.get(seriesId)
      if (!destination) continue
      // Only propagate when at least one selected row of this series
      // actually moved; otherwise a no-op batch would still rewrite the
      // template and bump versions for no reason.
      const movedInSeries = rows.some(
        (row) => row.recurringSeriesId === seriesId,
      )
      if (!movedInSeries) continue
      const snapshot = seriesSnapshots.get(seriesId)
      if (!snapshot) continue
      const templateChanged = snapshot.template.categoryId !== destination
      const anchorSequence = anchorSequenceBySeriesId.get(seriesId)
      const siblingWhere = {
        recurringSeriesId: seriesId,
        ledgerId: group.ledgerId,
        categoryId: { not: destination },
        ...(scope === 'THIS_AND_FUTURE' && anchorSequence != null
          ? { recurrenceSequence: { gte: anchorSequence } }
          : {}),
      } as const
      const siblings = await tx.expense.findMany({
        where: siblingWhere,
        select: { id: true },
      })
      let siblingCount = 0
      for (let offset = 0; offset < siblings.length; offset += 500) {
        const chunk = siblings.slice(offset, offset + 500)
        const swept = await tx.expense.updateMany({
          where: {
            id: { in: chunk.map((s) => s.id) },
            ledgerId: group.ledgerId,
            recurringSeriesId: seriesId,
            categoryId: { not: destination },
          },
          data: { categoryId: destination, version: { increment: 1 } },
        })
        siblingCount += swept.count
      }
      const claimed = await tx.recurringExpenseSeries.updateMany({
        where: { id: seriesId, templateVersion: snapshot.templateVersion },
        data: {
          template: {
            ...snapshot.template,
            categoryId: destination,
          },
          templateVersion: { increment: 1 },
          version: { increment: 1 },
        },
      })
      if (claimed.count === 0) {
        throw new Error(
          'Recurring expense series changed while it was being updated; retry the update',
        )
      }
      // Mark propagated rows in the activity payload so the feed can
      // distinguish explicitly selected rows from scope-expanded ones.
      // `occurrenceCount` covers every sibling the sweep converged
      // (selected rows that already moved plus healed diverged rows),
      // including rows that sat on the destination before this batch.
      const siblingIds = new Set(siblings.map((s) => s.id))
      for (const row of rows) {
        if (row.recurringSeriesId === seriesId) {
          row.propagation =
            siblingIds.has(row.expenseId) || movedIds.has(row.expenseId)
              ? (scope as 'THIS_AND_FUTURE' | 'WHOLE_SERIES')
              : 'SELECTED'
        }
      }
      seriesUpdated.push({
        seriesId,
        propagation: scope,
        occurrenceCount: siblingCount,
        templateChanged,
        toCategoryId: destination as CategoryId,
      })
      distinctDestinations.add(destination)
    }

    const activityData: ExpenseCategoriesBulkUpdatedActivityData = {
      kind: 'expense_categories_bulk_updated',
      summary: `Bulk-categorized ${rows.length} expense${rows.length === 1 ? '' : 's'} from ${fromCategoryId}.`,
      count: rows.length,
      distinctCategories: distinctDestinations.size,
      rows,
      ...(seriesUpdated.length > 0 ? { seriesUpdated } : {}),
      fromCategoryId,
      ...(input.triggeredByAiConfidence !== undefined
        ? { triggeredByAiConfidence: input.triggeredByAiConfidence }
        : {}),
    }

    const activity = await logActivity(
      groupId,
      {
        type: 'EXPENSE_CATEGORIES_BULK_UPDATED',
        actor: { type: 'ACCOUNT', id: accountId },
        // subject intentionally omitted: the activity row refers to
        // many expenses, and per-row lookups would create O(N) join
        // pressure. The activity feed's "click to expand" UI reads
        // `data.rows` directly.
        data: activityData,
      },
      tx,
    )
    await planNotificationForActivity(tx, activity, {}, { boss })
    if (await hasEligibleWebhookEndpoints(tx, groupId, 'updated')) {
      const snapshots = await loadExpenseSnapshotsChunked(
        tx,
        rows.map((row) => row.expenseId),
      )
      await planExpenseBatchWebhook({
        tx,
        boss,
        sourceKey: `activity:${activity.id}:webhook-batch-v1`,
        activityId: activity.id,
        groupId,
        actorAccountId: accountId,
        operation: 'updated',
        source: 'bulk-category-update',
        occurredAt: activity.time,
        expenses: snapshots.map((expense) => ({
          expense,
          changedFields: ['category'],
        })),
      })
    }

    return {
      applied: rows.length,
      skipped: candidates.length - rows.length,
      distinctCategories: distinctDestinations.size,
      rows,
      seriesUpdated,
      touchedSeriesIds: [...scopeBySeriesId.keys()],
    } satisfies BulkCategorizeApplyResult
  }

  const result = args.transaction
    ? await apply(args.transaction)
    : await prisma.$transaction(apply)

  return result
}

/**
 * Read-side helper used by the AI preview / calibrate endpoints. Returns the
 * expenses eligible for bulk categorization: non-settlements whose `categoryId`
 * matches `fromCategoryId` and whose `ledgerId` is the group's. Read-only — no
 * side effects, so safe to call many times during calibration.
 */
export async function listBulkCategorizeCandidates(args: {
  groupId: string
  fromCategoryId?: string
  limit?: number
}): Promise<
  Array<{
    id: string
    title: string
    expenseDate: Date
    amount: number
    categoryId: string
    recurringSeriesId: string | null
    recurrenceSequence: number | null
  }>
> {
  const group = await prisma.group.findUnique({
    where: { id: args.groupId },
    select: { ledgerId: true },
  })
  if (!group) return []
  const from = args.fromCategoryId ?? DEFAULT_CATEGORY_ID
  if (from === SETTLEMENT_CATEGORY_ID) return []

  return prisma.expense.findMany({
    where: {
      ledgerId: group.ledgerId,
      categoryId: from,
    },
    select: {
      id: true,
      title: true,
      expenseDate: true,
      amount: true,
      categoryId: true,
      recurringSeriesId: true,
      recurrenceSequence: true,
    },
    orderBy: [{ expenseDate: 'desc' }, { createdAt: 'desc' }],
    take: args.limit ?? 500,
  })
}

/**
 * Type-only narrow used by callers that want a {@link DbExpense}- shaped row but
 * only have the lite projection above.
 */
export type BulkCategorizeCandidateRow = Awaited<
  ReturnType<typeof listBulkCategorizeCandidates>
>[number] & {
  // Defensive: even though we don't import the `Expense` type
  // directly, callers that pass a fetched row get this typed
  // hint at the call site.
  readonly __bulkCategorizeBrand?: never
}

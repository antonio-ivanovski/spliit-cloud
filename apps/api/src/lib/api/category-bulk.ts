import { prisma, Prisma } from '@spliit/db'
import {
  BULK_APPLY_HARD_LIMIT,
  DEFAULT_CATEGORY_ID,
  SETTLEMENT_CATEGORY_ID,
  categoryIdSchema,
  type CategoryId,
  type ExpenseCategoriesBulkUpdatedActivityData,
  type ExpenseCategoriesBulkUpdatedRow,
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

  if (input.changes.length === 0) {
    return {
      applied: 0,
      skipped: 0,
      distinctCategories: 0,
      rows: [],
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
    const candidates = await tx.expense.findMany({
      where: {
        ledgerId: group.ledgerId,
        id: { in: Array.from(wantedById.keys()) },
        categoryId: fromCategoryId,
      },
      select: { id: true, title: true, categoryId: true, version: true },
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
      } satisfies BulkCategorizeApplyResult
    }

    const rows: ExpenseCategoriesBulkUpdatedRow[] = []
    const distinctDestinations = new Set<string>()

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
        rows.push({
          expenseId: changed.id,
          title: changed.title,
          fromCategoryId: fromCategoryId as CategoryId,
          toCategoryId: changed.categoryId as CategoryId,
        })
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
        })
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
      } satisfies BulkCategorizeApplyResult
    }

    const activityData: ExpenseCategoriesBulkUpdatedActivityData = {
      kind: 'expense_categories_bulk_updated',
      summary: `Bulk-categorized ${rows.length} expense${rows.length === 1 ? '' : 's'} from ${fromCategoryId}.`,
      count: rows.length,
      distinctCategories: distinctDestinations.size,
      rows,
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

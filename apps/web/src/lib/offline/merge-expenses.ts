import { z } from 'zod'

import type { GroupExpenseSortBy, GroupExpenseSortDir } from './read-model'

/**
 * Incremental list merge for offline-first reads.
 *
 * Renders the downloaded snapshot immediately, then merges live network rows in
 * place when they arrive: added rows insert, changed rows patch, unchanged rows
 * keep their object identity so memoized cards bail out instead of re-rendering
 * the whole list.
 *
 * Offline-write seam: `pending` rows (locally created while offline, not yet
 * confirmed by the server) always win and are never dropped by network absence.
 * They carry client temp ids (`pending-` prefix) that can never collide with
 * server ids, so reconciliation is a delete-temp + insert-real when the flush
 * confirms. See `pending-expenses.ts`.
 */

export type MergeableExpense = {
  id: string
  expenseDate: Date | string
  createdAt: Date | string
  amount: number
  title?: string | null
} & Record<string, unknown>

export type PendingExpenseRow = MergeableExpense & {
  /** Client temp id, `pending-` prefixed. Never sent as the server id. */
  clientId: string
  /** Idempotency key for the future flush (reuses the create requestId). */
  requestId: string
  status: 'pending' | 'failed'
}

export function isPendingExpenseId(id: string): boolean {
  return id.startsWith('pending-')
}

/**
 * Validation for overlay rows read back from the legacy localStorage seam.
 * Dates survive the JSON round-trip as ISO strings (fresh rows hold `Date`s),
 * so both shapes validate; anything else is dropped as corrupt instead of
 * reaching the merge. Unknown extra fields pass through: list rows carry
 * projection fields this seam never interprets.
 */
const pendingDateSchema = z.union([z.date(), z.string().min(1)])

export const pendingExpenseRowSchema = z
  .object({
    id: z.string().min(1),
    expenseDate: pendingDateSchema,
    createdAt: pendingDateSchema,
    amount: z.number(),
    title: z.string().nullable().optional(),
    clientId: z.string().min(1),
    requestId: z.string().min(1),
    status: z.enum(['pending', 'failed']),
  })
  .catchall(z.unknown())

export type ValidatedPendingExpenseRow = z.infer<typeof pendingExpenseRowSchema>

function timeOf(value: Date | string | null | undefined): number {
  if (value == null) return 0
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime()
  return Number.isFinite(ms) ? ms : 0
}

/**
 * Canonical list order mirrors the server (`buildExpenseListOrderBy`) and the
 * offline worker (`sortGroupRecords`): primary field in the selected dir, then
 * fixed `createdAt` desc (expenseDate mode only), then fixed id desc. The
 * tie-breakers never follow the selected dir — merged rows must sort exactly
 * like server rows or the list visibly reshuffles on merge.
 */
function compareExpenses(
  left: MergeableExpense,
  right: MergeableExpense,
  sortBy: GroupExpenseSortBy,
  sortDir: GroupExpenseSortDir,
): number {
  const dir = sortDir === 'asc' ? 1 : -1
  if (sortBy === 'amount') {
    if (left.amount !== right.amount) {
      return (left.amount - right.amount) * dir
    }
  } else if (sortBy === 'createdAt') {
    const diff = timeOf(left.createdAt) - timeOf(right.createdAt)
    if (diff !== 0) return diff * dir
  } else {
    const diff = timeOf(left.expenseDate) - timeOf(right.expenseDate)
    if (diff !== 0) return diff * dir
    const createdDiff = timeOf(left.createdAt) - timeOf(right.createdAt)
    if (createdDiff !== 0) return -createdDiff
  }
  if (left.id === right.id) return 0
  return left.id < right.id ? 1 : -1
}

/**
 * Change detection over fields actually present on list rows. List rows carry
 * no `version` (detail-only), so identity is a content key over the rendered
 * projection: scalars plus participant/item shares. Unchanged rows reuse the
 * on-screen reference; anything missed here fails safe (extra re-render, never
 * stale data — the network reference always wins on mismatch).
 */
function scalarKey(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return String(value)
  }
  return JSON.stringify(value) ?? ''
}

function shareKey(value: unknown): string {
  if (!Array.isArray(value)) return ''
  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return ''
      const record = entry as Record<string, unknown>
      const participant = record.ledgerParticipant as
        | {
            id?: unknown
            name?: unknown
            removed?: unknown
            account?: { id?: unknown; name?: unknown } | null
          }
        | undefined
      return [
        scalarKey(
          participant?.id ??
            record.ledgerParticipantId ??
            record.participantId ??
            record.participant,
        ),
        scalarKey(participant?.name),
        scalarKey(participant?.removed),
        scalarKey(participant?.account?.id),
        scalarKey(participant?.account?.name),
        scalarKey(record.shares),
        scalarKey(record.id),
        scalarKey(record.title),
        scalarKey(record.amount),
      ].join(':')
    })
    .join('|')
}

function contentKey(row: MergeableExpense): string {
  return [
    scalarKey(row.title),
    scalarKey(row.amount),
    scalarKey(timeOf(row.expenseDate)),
    scalarKey(timeOf(row.createdAt)),
    scalarKey(row.expenseTimeZone),
    scalarKey(row.categoryId),
    scalarKey(row.splitMode),
    scalarKey(row.paidBySplitMode),
    scalarKey(row.originalAmount),
    scalarKey(row.originalCurrency),
    scalarKey(row.conversionRate),
    scalarKey(row.conversionSource),
    scalarKey(row.recurrenceSequence),
    scalarKey(row.documentCount),
    scalarKey(row.recurringSeriesId),
    scalarKey(row.recurringSeriesStatus),
    shareKey(row.paidByList),
    shareKey(row.paidFor),
    shareKey(row.items),
  ].join('~')
}

function sameContent(left: MergeableExpense, right: MergeableExpense): boolean {
  return contentKey(left) === contentKey(right)
}

export type MergeExpenseInput = {
  local: MergeableExpense[]
  /** Null while the network has no pages yet; merged falls back to local. */
  network: MergeableExpense[] | null
  pending?: PendingExpenseRow[]
  sortBy?: GroupExpenseSortBy
  sortDir?: GroupExpenseSortDir
  /**
   * True when the network window provably covers the filter (last loaded page
   * reports no further rows). Only then is a local-only row a real deletion.
   * While paginating (`false`), local-only rows are retained: the missing row
   * may sit on an unloaded network page (e.g. a concurrent insert shifted the
   * page boundary).
   */
  networkComplete?: boolean
}

export type MergeExpenseResult = {
  expenses: MergeableExpense[]
  addedIds: string[]
  updatedIds: string[]
  pendingIds: string[]
}

/**
 * Merge local + network + pending into one sorted list.
 *
 * Precedence: pending > network > local. Unchanged rows reuse the local object
 * reference (already on screen) so `React.memo` hits; changed rows take the
 * network reference. Pending rows reuse their own reference and sort alongside
 * everything else by the active comparator.
 *
 * Local-only rows are retained while the network window is partial (they may
 * sit on an unloaded page) and dropped only once the window is complete, where
 * absence means deletion.
 */
export function mergeExpenseLists({
  local,
  network,
  pending = [],
  sortBy = 'expenseDate',
  sortDir = 'desc',
  networkComplete = false,
}: MergeExpenseInput): MergeExpenseResult {
  const localById = new Map(local.map((row) => [row.id, row]))
  const networkById =
    network === null ? null : new Map(network.map((row) => [row.id, row]))
  const pendingById = new Map(pending.map((row) => [row.id, row]))

  const addedIds: string[] = []
  const updatedIds: string[] = []
  const out: MergeableExpense[] = []
  const seen = new Set<string>()

  // Pending first in map order; final sort decides visual position.
  for (const row of pending) {
    if (seen.has(row.id)) continue
    seen.add(row.id)
    out.push(row)
  }

  if (networkById === null) {
    for (const row of local) {
      if (seen.has(row.id) || pendingById.has(row.id)) continue
      seen.add(row.id)
      out.push(row)
    }
  } else {
    for (const [id, networkRow] of networkById) {
      if (seen.has(id)) continue
      seen.add(id)
      if (pendingById.has(id)) continue
      const localRow = localById.get(id)
      if (!localRow) {
        addedIds.push(id)
        out.push(networkRow)
      } else if (sameContent(localRow, networkRow)) {
        // Reuse the on-screen reference: no re-render for memoized cards.
        out.push(localRow)
      } else {
        updatedIds.push(id)
        out.push(networkRow)
      }
    }
    if (!networkComplete) {
      // Partial window (more network pages unloaded): a local-only row may
      // sit on an unloaded page, so retain it. Complete windows drop
      // local-only rows as deletions.
      for (const row of local) {
        if (seen.has(row.id) || pendingById.has(row.id)) continue
        seen.add(row.id)
        out.push(row)
      }
    }
  }

  out.sort((a, b) => compareExpenses(a, b, sortBy, sortDir))

  return {
    expenses: out,
    addedIds,
    updatedIds,
    pendingIds: pending.map((row) => row.id),
  }
}

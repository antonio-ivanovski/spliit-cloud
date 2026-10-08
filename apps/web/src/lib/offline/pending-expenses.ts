import { useEffect, useState } from 'react'

import { readLastAccount } from '@/lib/last-account'

import type { PendingExpenseRecord } from './contract'
import type { PendingExpenseRow } from './merge-expenses'
import { pendingExpenseRowSchema } from './merge-expenses'
import {
  buildPendingExpenseRecord,
  queuedExpenseResult,
  resolvePendingNamespace,
  savePendingExpenseRecord,
} from './pending-expense-queue'
import { OfflineWriteError } from './write-guard'

/**
 * Offline-write seam for expense creation.
 *
 * Phase 1: the write guard diverts `groups.expenses.create` here while
 * known-offline instead of throwing. Enqueue persists the validated record to
 * the Dexie `pendingExpenses` outbox (key `[namespace+groupId+clientId]`,
 * caller-provided `requestId` as the idempotency key) and mirrors it into this
 * overlay Map so the merge path (`mergeExpenseLists` + `useOfflineExpenses`)
 * renders it immediately with pending-wins precedence and `pending-` temp ids.
 * The reconnect flush sends rows in `createdAt` order, then reconciles by
 * delete-temp-id + insert-real-id (never mutating the temp row in place, so the
 * timeline remounts exactly one card).
 *
 * Temp ids are `pending-<requestId>` and can never collide with server ids
 * (`randomId()` hex, no prefix). Pending rows sort by the active list
 * comparator like any other row and render with a pending affordance.
 */

const STORAGE_KEY = 'spliit-pending-expenses-v1'

export type EnqueuePendingExpenseInput = {
  groupId: string
  requestId: string
  listItem: Omit<PendingExpenseRow, 'id' | 'clientId' | 'requestId' | 'status'>
}

type PendingMap = Map<string, PendingExpenseRow[]>

function loadInitial(): PendingMap {
  if (typeof window === 'undefined') return new Map()
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return new Map()
    const parsed = JSON.parse(raw) as Record<string, unknown>
    // zod at this legacy JSON boundary: rows predate validation, so corrupt
    // entries drop instead of reaching the merge. (Effect Schema decodes only
    // inside the new flush pipeline, which reads the Dexie outbox — never
    // this seam. zod here because the seam's durable format is JSON and the
    // check runs synchronously in the React read path with no Effect runtime.)
    const entries: Array<[string, PendingExpenseRow[]]> = []
    for (const [groupId, rows] of Object.entries(parsed)) {
      if (typeof groupId !== 'string' || !Array.isArray(rows)) continue
      const valid: PendingExpenseRow[] = []
      for (const row of rows) {
        const checked = pendingExpenseRowSchema.safeParse(row)
        if (checked.success) valid.push(checked.data)
      }
      if (valid.length > 0) entries.push([groupId, valid])
    }
    return new Map(entries)
  } catch {
    return new Map()
  }
}

const listeners = new Set<() => void>()
let cache: PendingMap | null = null

function getCache(): PendingMap {
  if (!cache) cache = loadInitial()
  return cache
}

function persist() {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(Object.fromEntries(getCache())),
    )
  } catch {
    // Quota/privacy: pending overlay stays memory-only for the session.
  }
}

function notify() {
  for (const listener of listeners) listener()
}

export function enqueuePendingExpenseForTests(
  groupId: string,
  row: PendingExpenseRow,
): void {
  const map = getCache()
  map.set(groupId, [...(map.get(groupId) ?? []), row])
  persist()
  notify()
}

export function clearPendingExpensesForTests(): void {
  cache = new Map()
  persist()
  notify()
}

/**
 * Test-only: forget the in-memory overlay so the next read re-runs
 * `loadInitial` (used to prove corrupt localStorage rows drop on load).
 */
export function resetPendingExpensesCacheForTests(): void {
  cache = null
}

/** Overlay row derived from a validated outbox record. */
function toOverlayRow(record: PendingExpenseRecord): PendingExpenseRow {
  return {
    id: record.clientId,
    clientId: record.clientId,
    requestId: record.requestId,
    status: record.status,
    expenseDate: record.expense.expenseDate,
    createdAt: new Date(record.createdAtMs),
    amount: record.expense.amount,
    title: record.expense.title,
  }
}

function upsertOverlayRow(groupId: string, row: PendingExpenseRow): void {
  const map = getCache()
  const existing = map.get(groupId) ?? []
  map.set(groupId, [
    ...existing.filter(
      (entry) => entry.clientId !== row.clientId && entry.id !== row.id,
    ),
    row,
  ])
  persist()
  notify()
}

export type EnqueuePendingExpenseResult = {
  readonly record: PendingExpenseRecord
  readonly queued: {
    readonly expenseId: string
    readonly recurringSeriesId: null
  }
}

/**
 * Queue one offline expense create. Validates the record (payload included),
 * persists it to the Dexie outbox, then mirrors it into the overlay.
 * Fail-closed: invalid input or a failed outbox write throws
 * `OfflineWriteError` with nothing enqueued — the pre-diversion behavior.
 * Idempotent by `requestId`: a repeated enqueue replaces the same temp row.
 */
export async function enqueuePendingExpense(input: {
  readonly groupId: string
  readonly requestId: string
  readonly expense: unknown
  readonly namespace?: string | null
  readonly createdAtMs?: number
}): Promise<EnqueuePendingExpenseResult> {
  const namespace =
    input.namespace ?? resolvePendingNamespace(readLastAccount()?.id)
  if (!namespace) throw new OfflineWriteError()
  const record = buildPendingExpenseRecord({
    namespace,
    groupId: input.groupId,
    requestId: input.requestId,
    expense: input.expense,
    ...(input.createdAtMs !== undefined
      ? { createdAtMs: input.createdAtMs }
      : {}),
  })
  if (!record) throw new OfflineWriteError()
  try {
    await savePendingExpenseRecord(record)
  } catch {
    throw new OfflineWriteError()
  }
  upsertOverlayRow(record.groupId, toOverlayRow(record))
  return { record, queued: queuedExpenseResult(record) }
}

/**
 * Mirror a flush outcome into the overlay. `sent` removes the temp row (the
 * real row arrives via the post-flush download); `failed` pins it as failed.
 * Unknown ids are ignored so duplicate resolutions stay idempotent.
 */
export function applyPendingExpenseResolution(input: {
  readonly groupId: string
  readonly clientId: string
  readonly outcome: 'sent' | 'failed'
}): void {
  const map = getCache()
  const rows = map.get(input.groupId)
  if (!rows) return
  const matches = (row: PendingExpenseRow) =>
    row.clientId === input.clientId || row.id === input.clientId
  if (input.outcome === 'sent') {
    const next = rows.filter((row) => !matches(row))
    if (next.length === rows.length) return
    if (next.length === 0) map.delete(input.groupId)
    else map.set(input.groupId, next)
  } else {
    let changed = false
    const next = rows.map((row) => {
      if (!matches(row) || row.status === 'failed') return row
      changed = true
      return { ...row, status: 'failed' as const }
    })
    if (!changed) return
    map.set(input.groupId, next)
  }
  persist()
  notify()
}

/**
 * Pending rows for one group. Stable array identity across unrelated group
 * updates so memoized lists don't re-render.
 */
export function usePendingExpenses(groupId: string): PendingExpenseRow[] {
  const [version, setVersion] = useState(0)

  useEffect(() => {
    const listener = () => setVersion((value) => value + 1)
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [])

  void version

  return getCache().get(groupId) ?? EMPTY
}

const EMPTY: PendingExpenseRow[] = []

import { useEffect, useState } from 'react'

import type { PendingExpenseRow } from './merge-expenses'

/**
 * Offline-write seam for expense creation.
 *
 * Today this store is always empty: expense writes are still blocked offline by
 * the transport write guard, so nothing enqueues. The merge path
 * (`mergeExpenseLists` + `useOfflineExpenses`) already overlays these rows with
 * pending-wins precedence and `pending-` temp ids, so the future flush only
 * needs to:
 *
 * 1. Persist this Map to a Dexie `pendingExpenses` table (key
 *    `[namespace+groupId+clientId]`) instead of localStorage, reusing the
 *    existing `commitNonce`-versioned invalidation + `dirtySince` channel.
 * 2. Divert `groups.expenses.create` at the write-guard choke
 *    (`assertTransportOnline`) into `enqueuePendingExpense` instead of
 *    throwing, reusing the caller-provided `requestId` as the idempotency key
 *    so replay-after-reconnect is safe.
 * 3. On reconnect, flush in `createdAt` order, then reconcile by delete-temp-id +
 *    insert-real-id (never mutate the temp row in place, so the timeline
 *    remounts exactly one card).
 *
 * Temp ids are `pending-<uuid>` and can never collide with server ids
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
    const parsed = JSON.parse(raw) as Record<string, PendingExpenseRow[]>
    return new Map(Object.entries(parsed))
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

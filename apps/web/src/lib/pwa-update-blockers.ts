import { useEffect } from 'react'

import type { PwaBuild } from './pwa-build'

type Listener = () => void

let nextId = 1
export type PwaCheckpoint = { attemptId: string; build: PwaBuild }
const blockers = new Map<
  number,
  {
    reason: string
    active?: () => boolean
    checkpoint?: (context: PwaCheckpoint) => void
  }
>()
const listeners = new Set<Listener>()
let protectionInitialized = false

/** Publish changes to work tracked by a live active predicate. */
export function notifyPwaUpdateBlockersChanged() {
  listeners.forEach((listener) => listener())
}

/** Register work that an automatic reload must not interrupt. */
export function registerPwaUpdateBlocker(
  reason: string,
  checkpoint?: (context: PwaCheckpoint) => void,
  active?: () => boolean,
): () => void {
  const id = nextId++
  blockers.set(id, {
    reason,
    ...(checkpoint ? { checkpoint } : {}),
    ...(active ? { active } : {}),
  })
  notifyPwaUpdateBlockersChanged()
  return () => {
    if (blockers.delete(id)) notifyPwaUpdateBlockersChanged()
  }
}

/** React binding for reload-sensitive work. The reason is debug-only. */
export function usePwaUpdateBlocker(active: boolean, reason: string) {
  useEffect(() => {
    if (!active) return
    return registerPwaUpdateBlocker(reason)
  }, [active, reason])
}

/** Protect uncommitted text while an IME composition is active. */
export function usePwaUpdateCompositionGuard(reason = 'text-composition') {
  useEffect(() => {
    if (typeof document === 'undefined') return
    let unregister: (() => void) | undefined
    const end = () => {
      unregister?.()
      unregister = undefined
    }
    const start = () => {
      unregister ??= registerPwaUpdateBlocker(reason)
    }
    document.addEventListener('compositionstart', start)
    document.addEventListener('compositionend', end)
    return () => {
      document.removeEventListener('compositionstart', start)
      document.removeEventListener('compositionend', end)
      end()
    }
  }, [reason])
}

export function hasPwaUpdateBlockers(): boolean {
  return [...blockers.values()].some(
    (blocker) => !blocker.active || blocker.active(),
  )
}

export function hasHardPwaUpdateBlockers(): boolean {
  return [...blockers.values()].some(
    (blocker) => (!blocker.active || blocker.active()) && !blocker.checkpoint,
  )
}

/** Only the update coordinator may treat successfully checkpointed work as safe. */
export function checkpointPwaUpdateWork(context: PwaCheckpoint): number {
  let count = 0
  for (const blocker of blockers.values()) {
    if (blocker.active && !blocker.active()) continue
    if (!blocker.checkpoint)
      throw new Error('Unfinished work cannot be restored')
    blocker.checkpoint(context)
    count++
  }
  return count
}

export function getPwaUpdateBlockerCount(): number {
  return [...blockers.values()].filter(
    (blocker) => !blocker.active || blocker.active(),
  ).length
}

export function getPwaUpdateBlockerReasons(): readonly string[] {
  return [...blockers.values()]
    .filter((blocker) => !blocker.active || blocker.active())
    .map((blocker) => blocker.reason)
}

export function subscribePwaUpdateBlockers(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** An empty registry is meaningful only after blocker producers have mounted. */
export function markPwaUpdateProtectionInitialized() {
  if (protectionInitialized) return
  protectionInitialized = true
  notifyPwaUpdateBlockersChanged()
}

export function isPwaUpdateProtectionInitialized(): boolean {
  return protectionInitialized
}

/** Test-only reset. */
export function resetPwaUpdateBlockersForTests() {
  blockers.clear()
  protectionInitialized = false
}

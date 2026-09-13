import { useEffect } from 'react'

type Listener = () => void

let nextId = 1
const blockers = new Map<number, string>()
const listeners = new Set<Listener>()
let protectionInitialized = false

function emit() {
  listeners.forEach((listener) => listener())
}

/** Register work that an automatic reload must not interrupt. */
export function registerPwaUpdateBlocker(reason: string): () => void {
  const id = nextId++
  blockers.set(id, reason)
  emit()
  return () => {
    if (blockers.delete(id)) emit()
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
  return blockers.size > 0
}

export function getPwaUpdateBlockerCount(): number {
  return blockers.size
}

export function getPwaUpdateBlockerReasons(): readonly string[] {
  return [...blockers.values()]
}

export function subscribePwaUpdateBlockers(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** An empty registry is meaningful only after blocker producers have mounted. */
export function markPwaUpdateProtectionInitialized() {
  if (protectionInitialized) return
  protectionInitialized = true
  emit()
}

export function isPwaUpdateProtectionInitialized(): boolean {
  return protectionInitialized
}

/** Test-only reset. */
export function resetPwaUpdateBlockersForTests() {
  blockers.clear()
  protectionInitialized = false
}

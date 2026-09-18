import { useSyncExternalStore } from 'react'

import {
  OFFLINE_OPEN_TIMEOUT_MS,
  OFFLINE_STORAGE_BLOCKED_MESSAGE,
} from './contract'
import type { OfflineErrorCode } from './errors'
import { toStatusErrorCode } from './errors'
import { OfflineRepository } from './repository'

/**
 * Minimal storage-open store.
 *
 * This owns only IndexedDB opening status for the durable repository. It does
 * not implement account lifecycle, session verification, cross-tab events, sync
 * passes, or any UI (lifecycle/sync own those and must keep `useCurrentAccount`
 * stable). It returns status values so retry UI can mount; it never mounts UI
 * itself.
 *
 * Opening rules: after {@link OFFLINE_OPEN_TIMEOUT_MS} a still-pending open
 * stops blocking and reports `unavailable` with a retry hook while the open
 * keeps running. Stale/late results after `cancel`/`retry` are ignored and
 * their connections closed; an eventual success is accepted only when its
 * lifecycle generation is still current.
 */

export type OfflineStorageStatus =
  | 'opening'
  | 'available'
  | 'unavailable'
  | 'blocked'
  | 'quota-error'

export type OfflineStoreSnapshot = {
  status: OfflineStorageStatus
  blockedMessage: string | null
  errorCode: OfflineErrorCode | null
  retryCount: number
  lifecycleGeneration: number
}

export type OpenRepositoryHooks = {
  onBlocked: () => void
  onVersionChange: () => void
  signal: AbortSignal
}

export type OpenRepositoryFn = (
  hooks: OpenRepositoryHooks,
) => Promise<OfflineRepository>

export type OfflineStoreOptions = {
  openTimeoutMs?: number
  openRepository?: OpenRepositoryFn
  /** Hook: broadcast `storage-close` after our conn closes. */
  onStorageClose?: () => void
}

export function createOfflineStore(options?: OfflineStoreOptions) {
  const openTimeoutMs = options?.openTimeoutMs ?? OFFLINE_OPEN_TIMEOUT_MS
  const openRepository =
    options?.openRepository ??
    ((hooks: OpenRepositoryHooks) =>
      OfflineRepository.open({
        onBlocked: hooks.onBlocked,
        onVersionChange: hooks.onVersionChange,
        signal: hooks.signal,
      }))

  const listeners = new Set<() => void>()
  let lifecycleGeneration = 0
  let retryCount = 0
  let repository: OfflineRepository | null = null
  let controller: AbortController | null = null
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  let snapshot: OfflineStoreSnapshot = {
    status: 'opening',
    blockedMessage: null,
    errorCode: null,
    retryCount: 0,
    lifecycleGeneration: 0,
  }

  function emit(next: OfflineStoreSnapshot) {
    snapshot = next
    for (const listener of listeners) listener()
  }

  function setStatus(
    status: OfflineStorageStatus,
    extra?: Partial<OfflineStoreSnapshot>,
  ) {
    emit({
      ...snapshot,
      status,
      blockedMessage:
        extra?.blockedMessage !== undefined
          ? extra.blockedMessage
          : status === 'blocked'
            ? OFFLINE_STORAGE_BLOCKED_MESSAGE
            : null,
      errorCode: extra?.errorCode ?? null,
      retryCount,
      lifecycleGeneration,
      ...extra,
    })
  }

  function clearTimer() {
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
  }

  function closeRepository() {
    if (repository) {
      try {
        repository.close()
      } catch {
        // Ignore close failures in teardown.
      }
      repository = null
    }
  }

  async function open(): Promise<void> {
    // A new lifecycle generation fences any in-flight open: only the current
    // generation may publish `available`.
    lifecycleGeneration += 1
    const generation = lifecycleGeneration
    controller?.abort()
    controller = new AbortController()
    const signal = controller.signal
    clearTimer()
    // Retain the old repository until the new open succeeds; only swap and
    // close the old connection on success so a slow retry never drops a
    // usable connection prematurely.
    const previousRepository = repository
    setStatus('opening', { blockedMessage: null, errorCode: null })

    timeoutId = setTimeout(() => {
      if (generation !== lifecycleGeneration) return
      if (snapshot.status !== 'opening') return
      // Remove the blocking spinner after 3s; online pages stay usable and
      // a retry hook is offered. The open keeps running underneath.
      setStatus('unavailable', { errorCode: 'storage-unavailable' })
    }, openTimeoutMs)
    if (typeof timeoutId === 'object' && 'unref' in timeoutId) {
      timeoutId.unref?.()
    }

    const handleBlocked = () => {
      if (generation !== lifecycleGeneration) return
      // Never auto-reload a dirty form or wipe the DB as an upgrade
      // shortcut; the blocked message is shown with a retry action.
      setStatus('blocked', {
        blockedMessage: OFFLINE_STORAGE_BLOCKED_MESSAGE,
        errorCode: 'storage-blocked',
      })
    }
    const handleVersionChange = () => {
      if (generation !== lifecycleGeneration) return
      // Our old connection already closed in the repository's `blocking`
      // handler. Notify other tabs so they can close/reload.
      closeRepository()
      try {
        options?.onStorageClose?.()
      } catch {
        // Notification failures must not break storage state.
      }
    }

    try {
      const opened = await openRepository({
        onBlocked: handleBlocked,
        onVersionChange: handleVersionChange,
        signal,
      })
      if (generation !== lifecycleGeneration || signal.aborted) {
        // Stale/late success after cancel/retry: close and ignore.
        // The retained previous repository (if any) stays owned by its
        // successful generation; a later successful open swaps it.
        try {
          opened.close()
        } catch {
          // Ignore close failures for stale connections.
        }
        return
      }
      clearTimer()
      if (previousRepository && previousRepository !== opened) {
        try {
          previousRepository.close()
        } catch {
          // Ignore close failures for the replaced connection.
        }
      }
      repository = opened
      setStatus('available', { blockedMessage: null, errorCode: null })
    } catch (error) {
      if (generation !== lifecycleGeneration || signal.aborted) return
      clearTimer()
      if (toStatusErrorCode(error) === 'quota-exceeded') {
        setStatus('quota-error', { errorCode: 'quota-exceeded' })
        return
      }
      setStatus('unavailable', { errorCode: toStatusErrorCode(error) })
    }
  }

  async function retry(): Promise<void> {
    retryCount += 1
    await open()
  }

  function cancel(): void {
    // Bump the generation so any late open result is ignored.
    lifecycleGeneration += 1
    controller?.abort()
    controller = null
    clearTimer()
    if (snapshot.status === 'opening') {
      // Never leave the machine stuck in `opening` after cancellation;
      // report `unavailable` so retry UI can take over.
      setStatus('unavailable', { errorCode: 'storage-unavailable' })
      return
    }
    emit({ ...snapshot, lifecycleGeneration })
  }

  function close(): void {
    // Explicit terminal state: bump fencing, drop the connection, and never
    // leave `available` (which would keep getRepository() non-null).
    lifecycleGeneration += 1
    controller?.abort()
    controller = null
    clearTimer()
    closeRepository()
    setStatus('unavailable', { blockedMessage: null, errorCode: null })
  }

  /** Surface a write-time failure without mounting UI. */
  function reportError(error: unknown): void {
    const code = toStatusErrorCode(error)
    if (code === 'quota-exceeded') {
      setStatus('quota-error', { errorCode: 'quota-exceeded' })
    } else if (code === 'storage-blocked') {
      setStatus('blocked', {
        blockedMessage: OFFLINE_STORAGE_BLOCKED_MESSAGE,
        errorCode: 'storage-blocked',
      })
    } else {
      setStatus('unavailable', { errorCode: 'storage-unavailable' })
    }
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  function getSnapshot(): OfflineStoreSnapshot {
    return snapshot
  }

  function getRepository(): OfflineRepository | null {
    return snapshot.status === 'available' ? repository : null
  }

  return {
    subscribe,
    getSnapshot,
    getRepository,
    open,
    retry,
    cancel,
    close,
    reportError,
  }
}

export type OfflineStore = ReturnType<typeof createOfflineStore>

/**
 * Retry-UI hook. Returns storage status without mounting UI. Other modules own
 * lifecycle/sync; this hook only subscribes to open status.
 */
export function useOfflineStorageStatus(
  store: OfflineStore,
): OfflineStoreSnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}

export { OFFLINE_STORAGE_BLOCKED_MESSAGE }

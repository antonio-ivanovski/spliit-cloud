import { getApiBaseUrl } from '@/lib/api-url'
import type { AuthAccount } from '@/lib/auth'

import type { TransportState } from './connectivity'
import { buildNamespace } from './contract'

/**
 * Central account-ownership lifecycle.
 *
 * Single owner for last-account write/clear side effects. An offline identity
 * is restored only from matching last-account metadata plus a non-revoked
 * namespace; other namespaces are never scanned to choose an identity.
 *
 * Cold start runs local restore + session verification concurrently. Cached
 * identity may display matching local reads immediately; no server mutation
 * runs until verification. Network timeout / 5xx preserves the read identity; a
 * successful `get-session` null revokes it. Hanging waits are skipped when the
 * browser explicitly reports offline.
 *
 * Fencing works without BroadcastChannel via the synchronous revocation marker
 * `spliit:offline:revoked:${encodeURIComponent(namespace)}` (unique UUID value,
 * written before async deletion, checked before restore/commit) plus IDB
 * generation checks. The fallback key `spliit:offline:event` carries `{event,
 * nonce}` for tabs without BroadcastChannel. Failed storage access is never
 * treated as successful clearance.
 */

export type SessionState =
  | 'checking'
  | 'verified'
  | 'offline-identity'
  | 'signed-out'

export type LifecycleSnapshot = {
  account: AuthAccount | null
  session: SessionState
  namespace: string | null
  generation: number
  cleanupError: string | null
  invalidated: boolean
  lastVerifiedAt: number | null
  verifyAttempt: number
}

export const OFFLINE_CHANNEL_NAME = 'spliit-offline-v1'
export const REVOKED_KEY_PREFIX = 'spliit:offline:revoked:'
export const FALLBACK_EVENT_KEY = 'spliit:offline:event'
export const SESSION_VERIFY_TIMEOUT_MS = 8000

export type OfflineChannelEventType =
  | 'committed'
  | 'catalog-changed'
  | 'dirty'
  | 'cleared'
  | 'revoked'
  | 'storage-close'

export type OfflineChannelEvent = {
  type: OfflineChannelEventType
  namespace: string
  generation: number
  groupId?: string
  nonce: string
}

export type SessionFetchResult =
  | { kind: 'verified'; account: AuthAccount }
  | { kind: 'signed-out' }
  | { kind: 'network-failure'; error?: unknown }
  | { kind: 'server-failure'; status?: number }
  | { kind: 'aborted' }

export type VerifySessionFn = (
  signal: AbortSignal,
) => Promise<SessionFetchResult>

export function revokedKeyFor(namespace: string): string {
  return `${REVOKED_KEY_PREFIX}${encodeURIComponent(namespace)}`
}

function storageOrNull(explicit?: Storage | null): Storage | null {
  if (explicit !== undefined) return explicit
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export function newEventUuid(randomUUID?: () => string): string {
  try {
    if (randomUUID) return randomUUID()
    const fn = globalThis.crypto?.randomUUID?.bind(globalThis.crypto)
    if (fn) return fn()
  } catch {
    // Fall through to Math.random fallback.
  }
  return `uuid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

/** Read the revocation marker. `null` = absent or unreadable (check IDB too). */
export function readRevokedMarker(
  namespace: string,
  storage?: Storage | null,
): string | null {
  const store = storageOrNull(storage)
  if (!store) return null
  try {
    return store.getItem(revokedKeyFor(namespace))
  } catch {
    return null
  }
}

/**
 * Synchronously write the revocation marker before async deletion. Returns
 * `false` when storage is unavailable — callers must NOT treat that as
 * successful clearance and must keep the generation fenced.
 */
export function writeRevokedMarkerSync(
  namespace: string,
  uuid: string,
  storage?: Storage | null,
): boolean {
  const store = storageOrNull(storage)
  if (!store) return false
  try {
    store.setItem(revokedKeyFor(namespace), uuid)
    return true
  } catch {
    return false
  }
}

export function clearRevokedMarker(
  namespace: string,
  storage?: Storage | null,
): boolean {
  const store = storageOrNull(storage)
  if (!store) return false
  try {
    store.removeItem(revokedKeyFor(namespace))
    return true
  } catch {
    return false
  }
}

export function hasRevokedMarker(
  namespace: string,
  storage?: Storage | null,
): boolean {
  return readRevokedMarker(namespace, storage) !== null
}

/**
 * HTTP 401 / tRPC UNAUTHORIZED initiates session verification. A group
 * FORBIDDEN alone never signs the user out.
 */
export function shouldVerifySessionOnError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const record = error as Record<string, unknown>
  // Direct HTTP shape.
  if (record.status === 401 || record.statusCode === 401) return true
  // tRPC shape: error.data.code === 'UNAUTHORIZED'.
  const data = record.data as Record<string, unknown> | undefined
  if (data && data.code === 'UNAUTHORIZED') return true
  // Nested cause (TRPCClientError wraps the server shape).
  const cause = record.cause as Record<string, unknown> | undefined
  if (cause) {
    if (cause.status === 401 || cause.statusCode === 401) return true
    const causeData = cause.data as Record<string, unknown> | undefined
    if (causeData && causeData.code === 'UNAUTHORIZED') return true
  }
  return false
}

export function isForbiddenError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const record = error as Record<string, unknown>
  const data = record.data as Record<string, unknown> | undefined
  if (data?.code === 'FORBIDDEN') return true
  if (record.status === 403 || record.statusCode === 403) return true
  return false
}

export type OfflineChannelHandler = (event: OfflineChannelEvent) => void

export type OfflineChannelOptions = {
  broadcastChannel?: typeof BroadcastChannel | null
  storage?: Storage | null
  randomUUID?: () => string
}

function parseChannelEvent(raw: string): OfflineChannelEvent | null {
  try {
    const value = JSON.parse(raw) as Partial<OfflineChannelEvent>
    if (
      typeof value.type !== 'string' ||
      typeof value.namespace !== 'string' ||
      typeof value.generation !== 'number' ||
      typeof value.nonce !== 'string'
    ) {
      return null
    }
    if (
      value.type !== 'committed' &&
      value.type !== 'catalog-changed' &&
      value.type !== 'dirty' &&
      value.type !== 'cleared' &&
      value.type !== 'revoked' &&
      value.type !== 'storage-close'
    ) {
      return null
    }
    // Never carry payloads/profile/tokens: reject events with extra data.
    return {
      type: value.type,
      namespace: value.namespace,
      generation: value.generation,
      ...(typeof value.groupId === 'string' ? { groupId: value.groupId } : {}),
      nonce: value.nonce,
    }
  } catch {
    return null
  }
}

/**
 * Cross-tab channel `spliit-offline-v1`. BroadcastChannel with a storage-event
 * fallback carrying an event nonce. No payloads, profile data, or tokens.
 * Deletion/fencing never depends on this channel (markers + IDB generation are
 * authoritative).
 */
export function createOfflineChannel(
  onEvent: OfflineChannelHandler,
  options?: OfflineChannelOptions,
) {
  const randomUUID = options?.randomUUID
  const explicitStorage = options?.storage
  const BroadcastImpl =
    options?.broadcastChannel !== undefined
      ? options.broadcastChannel
      : typeof BroadcastChannel !== 'undefined'
        ? BroadcastChannel
        : null
  const seenNonces = new Set<string>()
  let closed = false
  let bc: BroadcastChannel | null = null
  let storageListener: ((event: StorageEvent) => void) | null = null

  function emit(event: OfflineChannelEvent) {
    if (closed) return
    if (seenNonces.has(event.nonce)) return
    seenNonces.add(event.nonce)
    if (seenNonces.size > 100) {
      const first = seenNonces.values().next().value
      if (first) seenNonces.delete(first)
    }
    onEvent(event)
  }

  if (BroadcastImpl) {
    try {
      bc = new BroadcastImpl(OFFLINE_CHANNEL_NAME)
      bc.onmessage = (message: MessageEvent) => {
        const parsed = parseChannelEvent(
          typeof message.data === 'string'
            ? message.data
            : JSON.stringify(message.data ?? ''),
        )
        if (parsed) emit(parsed)
      }
    } catch {
      bc = null
    }
  }

  // Storage fallback is always installed (when storage exists) so tabs
  // without BroadcastChannel still receive revocations. Dedupe via nonce.
  const fallbackStorage =
    explicitStorage !== undefined ? explicitStorage : storageOrNull(undefined)
  if (fallbackStorage && typeof window !== 'undefined') {
    storageListener = (event: StorageEvent) => {
      if (event.key !== FALLBACK_EVENT_KEY || !event.newValue) return
      const parsed = parseChannelEvent(event.newValue)
      if (parsed) emit(parsed)
    }
    window.addEventListener('storage', storageListener)
  }

  function post(
    event: Omit<OfflineChannelEvent, 'nonce'> & { nonce?: string },
  ): string {
    const nonce = event.nonce ?? newEventUuid(randomUUID)
    const full: OfflineChannelEvent = { ...event, nonce } as OfflineChannelEvent
    const serialized = JSON.stringify(full)
    if (bc) {
      try {
        bc.postMessage(serialized)
      } catch {
        // Broadcast failures must not block marker-based fencing.
      }
    }
    // Always write the fallback key as well (carries event + nonce) so
    // BroadcastChannel-less tabs still observe it. Failures are ignored:
    // markers + generation checks remain authoritative.
    try {
      fallbackStorage?.setItem(FALLBACK_EVENT_KEY, serialized)
    } catch {
      // Ignore: fencing does not depend on the fallback.
    }
    return nonce
  }

  function close() {
    closed = true
    try {
      bc?.close()
    } catch {
      // Ignore close failures.
    }
    bc = null
    if (storageListener && typeof window !== 'undefined') {
      window.removeEventListener('storage', storageListener)
    }
    storageListener = null
  }

  return { post, close }
}

export type LifecyclePersistedHooks = {
  /** Physically delete a namespace's payloads. Throw on failure. */
  deleteNamespace?: (namespace: string, generation: number) => Promise<void>
  /** Finish deletion of old revoked payloads during reactivation. */
  finishRevokedDeletion?: (namespace: string) => Promise<void>
  /** Reset dataRevision/lease for a new empty lifecycle; returns generation. */
  resetLifecycle?: (namespace: string) => Promise<{ generation: number }>
  /** Read the IDB control record for focus rechecks (null = missing). */
  readControl?: (
    namespace: string,
  ) => Promise<{ revoked: boolean; generation: number } | null>
  /** Preserve enabled/disabled pref across reactivation. */
  readEnabledPref?: (namespace: string) => Promise<boolean | null>
  /** Clear in-memory worker working set (no-op when no worker exists). */
  clearWorkerMemory?: () => void
}

export type OfflineLifecycleOptions = {
  readLastAccount: () => AuthAccount | null
  writeLastAccount: (account: AuthAccount) => void
  clearLastAccount: () => void
  resolveNamespace?: (accountId: string) => string
  verifySession: VerifySessionFn
  queryClient?: {
    cancelQueries?: () => Promise<void>
    clear?: () => void
    removeQueries?: () => void
  }
  navigate?: (path: string) => void
  storage?: Storage | null
  randomUUID?: () => string
  now?: () => number
  isNavigatorOnline?: () => boolean
  persisted?: LifecyclePersistedHooks
  channel?: ReturnType<typeof createOfflineChannel> | null
  onEventBroadcast?: (event: Omit<OfflineChannelEvent, 'nonce'>) => void
}

export function defaultResolveNamespace(accountId: string): string {
  try {
    return buildNamespace(getApiBaseUrl(), accountId)
  } catch {
    return buildNamespace('http://localhost:3001', accountId)
  }
}

export function createOfflineLifecycle(options: OfflineLifecycleOptions) {
  const readLastAccount = options.readLastAccount
  const writeLastAccount = options.writeLastAccount
  const clearLastAccountFn = options.clearLastAccount
  const resolveNamespace =
    options.resolveNamespace ?? ((id: string) => defaultResolveNamespace(id))
  const verifySessionFn = options.verifySession
  const now = options.now ?? Date.now
  const isNavigatorOnline =
    options.isNavigatorOnline ??
    (() =>
      typeof navigator === 'undefined' ? true : navigator.onLine !== false)
  const persisted = options.persisted ?? {}
  const randomUUID = options.randomUUID

  const listeners = new Set<() => void>()
  let snapshot: LifecycleSnapshot = {
    account: null,
    session: 'checking',
    namespace: null,
    generation: 0,
    cleanupError: null,
    invalidated: false,
    lastVerifiedAt: null,
    verifyAttempt: 0,
  }
  // Per-namespace fenced generations (in-memory; IDB control is durable).
  const fencedGenerations = new Map<string, number>()
  let switchAbortController: AbortController | null = null
  let verifyAbortController: AbortController | null = null
  let verifyInFlight: Promise<void> | null = null
  let bootstrapped = false
  let disposed = false
  let markerValueForCurrent: string | null = null
  let lastCleanupFailure: { namespace: string; generation: number } | null =
    null

  function emit() {
    for (const listener of listeners) listener()
  }

  function setSnapshot(next: LifecycleSnapshot) {
    snapshot = next
    emit()
  }

  function currentGeneration(): number {
    if (snapshot.namespace) {
      return fencedGenerations.get(snapshot.namespace) ?? snapshot.generation
    }
    return snapshot.generation
  }

  function bumpGeneration(namespace: string | null): number {
    if (!namespace) {
      const next = snapshot.generation + 1
      setSnapshot({ ...snapshot, generation: next })
      return next
    }
    const current = fencedGenerations.get(namespace) ?? snapshot.generation
    const next = current + 1
    fencedGenerations.set(namespace, next)
    if (snapshot.namespace === namespace) {
      setSnapshot({ ...snapshot, generation: next })
    }
    return next
  }

  function safeWriteLastAccount(account: AuthAccount) {
    // Single lifecycle owner for last-account writes. Never write while
    // invalidated by a cross-tab revocation unless a fresh verification
    // just succeeded (callers clear `invalidated` first).
    if (snapshot.invalidated) return
    try {
      writeLastAccount(account)
    } catch {
      // Storage failures must not break the session state machine.
    }
  }

  function safeClearLastAccount() {
    try {
      clearLastAccountFn()
    } catch {
      // Ignore: revocation marker + generation fencing remain authoritative.
    }
  }

  function broadcast(event: Omit<OfflineChannelEvent, 'nonce'>): void {
    try {
      if (options.channel) {
        options.channel.post(event)
      } else {
        // Fallback notification key carries event + nonce for
        // BroadcastChannel-less tabs.
        const store = storageOrNull(options.storage)
        if (store) {
          try {
            store.setItem(
              FALLBACK_EVENT_KEY,
              JSON.stringify({ ...event, nonce: newEventUuid(randomUUID) }),
            )
          } catch {
            // Ignore: markers remain authoritative.
          }
        }
      }
      options.onEventBroadcast?.(event)
    } catch {
      // Broadcast failures never block fencing.
    }
  }

  function clearQueryMemory() {
    if (persisted.clearWorkerMemory) {
      try {
        persisted.clearWorkerMemory()
      } catch {
        // Ignore worker teardown failures.
      }
    }
    const qc = options.queryClient
    if (!qc) return
    try {
      void qc.cancelQueries?.()
    } catch {
      // Ignore cancel failures; clear still runs.
    }
    try {
      qc.clear?.()
    } catch {
      // Ignore clear failures; generation fencing still applies.
    }
  }

  async function deletePersistedOrFence(
    namespace: string,
    generation: number,
  ): Promise<void> {
    if (!persisted.deleteNamespace) return
    try {
      await persisted.deleteNamespace(namespace, generation)
      // Success clears a prior cleanup failure for the same namespace.
      if (
        snapshot.cleanupError === 'cleanup-failed' &&
        lastCleanupFailure?.namespace === namespace
      ) {
        lastCleanupFailure = null
        setSnapshot({ ...snapshot, cleanupError: null })
      }
    } catch {
      // Failure to physically delete must still fence A from reads/writes
      // and surface a cleanup failure (never claim success).
      lastCleanupFailure = { namespace, generation }
      setSnapshot({
        ...snapshot,
        cleanupError: 'cleanup-failed',
      })
    }
  }

  function fenceNamespaceSync(namespace: string): {
    generation: number
    marker: string
    markerWritten: boolean
  } {
    const marker = newEventUuid(randomUUID)
    const markerWritten = writeRevokedMarkerSync(
      namespace,
      marker,
      options.storage,
    )
    const generation = bumpGeneration(namespace)
    markerValueForCurrent = marker
    return { generation, marker, markerWritten }
  }

  /**
   * Cold-start restore: last-account metadata + non-revoked namespace only.
   * Never scans other namespaces. Checks the synchronous marker first, then the
   * live IDB control record when available.
   */
  async function restoreOfflineIdentity(): Promise<{
    account: AuthAccount | null
    namespace: string | null
  }> {
    let cached: AuthAccount | null = null
    try {
      cached = readLastAccount()
    } catch {
      cached = null
    }
    if (!cached) return { account: null, namespace: null }
    let namespace: string
    try {
      namespace = resolveNamespace(cached.id)
    } catch {
      return { account: null, namespace: null }
    }
    // Marker check before restore.
    if (hasRevokedMarker(namespace, options.storage))
      return { account: null, namespace: null }
    // Live control validation (missed revoke while unfocused).
    if (persisted.readControl) {
      try {
        const control = await persisted.readControl(namespace)
        if (control?.revoked) return { account: null, namespace: null }
        if (control && typeof control.generation === 'number') {
          fencedGenerations.set(
            namespace,
            Math.max(control.generation, currentGeneration()),
          )
        }
      } catch {
        // Control read failures preserve the cached identity for reads;
        // verification will resolve the session authoritatively.
      }
    }
    return { account: cached, namespace }
  }

  async function runVerification(): Promise<void> {
    if (disposed) return
    if (verifyInFlight) return verifyInFlight
    const task = (async () => {
      verifyAbortController?.abort()
      verifyAbortController = new AbortController()
      const signal = verifyAbortController.signal
      const attempt = snapshot.verifyAttempt + 1
      setSnapshot({ ...snapshot, verifyAttempt: attempt })
      // Skip hanging session waits when the browser explicitly reports
      // offline: preserve the cached read identity immediately.
      if (!isNavigatorOnline()) {
        if (snapshot.account) {
          setSnapshot({ ...snapshot, session: 'offline-identity' })
        } else {
          setSnapshot({ ...snapshot, session: 'signed-out' })
        }
        return
      }
      let result: SessionFetchResult
      try {
        const timeoutMs = SESSION_VERIFY_TIMEOUT_MS
        const timeout = new Promise<SessionFetchResult>((resolve) => {
          const id = setTimeout(
            () =>
              resolve({ kind: 'network-failure', error: new Error('timeout') }),
            timeoutMs,
          )
          if (typeof id === 'object' && 'unref' in id) {
            ;(id as { unref?: () => void }).unref?.()
          }
          signal.addEventListener('abort', () => {
            clearTimeout(id)
            resolve({ kind: 'aborted' })
          })
        })
        result = await Promise.race([verifySessionFn(signal), timeout])
      } catch (error) {
        result = { kind: 'network-failure', error }
      }
      if (disposed || signal.aborted) return
      // Marker may have changed during verification (cross-tab revoke):
      // lifecycle callbacks capture the marker value and reject on change.
      const activeNamespace = snapshot.namespace
      const capturedMarker =
        activeNamespace != null
          ? readRevokedMarker(activeNamespace, options.storage)
          : null
      if (
        activeNamespace != null &&
        markerValueForCurrent !== null &&
        capturedMarker !== null &&
        capturedMarker !== markerValueForCurrent
      ) {
        // A newer revocation landed mid-verify; stay fenced.
        return
      }

      if (result.kind === 'verified') {
        await handleVerifiedAccount(result.account)
      } else if (result.kind === 'signed-out') {
        // Successful get-session null revokes the read identity.
        handleConfirmedSignedOut()
      } else if (
        result.kind === 'network-failure' ||
        result.kind === 'aborted'
      ) {
        // Timeout / genuine network failure preserves the read identity.
        // User/switch abort is also non-destructive (no session change).
        if (result.kind === 'aborted') return
        if (snapshot.account) {
          setSnapshot({ ...snapshot, session: 'offline-identity' })
        } else if (snapshot.session === 'checking') {
          setSnapshot({ ...snapshot, session: 'signed-out' })
        }
      } else if (result.kind === 'server-failure') {
        // HTTP response (including 4xx mapped by the provider): retain
        // snapshots, keep read identity. With no cached account, bound the
        // cold-start `checking` state to `signed-out` like the network branch.
        if (snapshot.account) {
          setSnapshot({ ...snapshot, session: 'offline-identity' })
        } else if (snapshot.session === 'checking') {
          setSnapshot({ ...snapshot, session: 'signed-out' })
        }
      }
    })()
    verifyInFlight = task.finally(() => {
      verifyInFlight = null
    })
    return verifyInFlight
  }

  async function handleVerifiedAccount(verified: AuthAccount): Promise<void> {
    const verifiedNamespace = resolveNamespace(verified.id)
    const current = snapshot.account
    const currentNamespace = snapshot.namespace

    // Different-account response while rendering A: fence A first.
    if (current && current.id !== verified.id && currentNamespace) {
      await switchToAccount(verified, verifiedNamespace, currentNamespace)
      return
    }

    // Same-account reactivation after a prior revocation: only from a fresh
    // uncached server session (this path), never from cached hook/probe.
    if (hasRevokedMarker(verifiedNamespace, options.storage)) {
      await reactivateRevokedNamespace(verified, verifiedNamespace)
      return
    }
    if (persisted.readControl) {
      try {
        const control = await persisted.readControl(verifiedNamespace)
        if (control?.revoked) {
          await reactivateRevokedNamespace(verified, verifiedNamespace)
          return
        }
      } catch {
        // Ignore control read failures; proceed with verification.
      }
    }

    // Fresh success clears cross-tab invalidation and (re)writes last-account
    // from this verified response only (stale hook data cannot repopulate).
    const wasInvalidated = snapshot.invalidated
    setSnapshot({
      ...snapshot,
      account: verified,
      session: 'verified',
      namespace: verifiedNamespace,
      invalidated: false,
      lastVerifiedAt: now(),
      cleanupError: snapshot.cleanupError,
    })
    if (wasInvalidated || !current || current.id !== verified.id) {
      // Clear the flag before writing so the single-owner write goes through.
      try {
        writeLastAccount(verified)
      } catch {
        // Ignore storage failures.
      }
    } else {
      safeWriteLastAccount(verified)
    }
    if (currentNamespace && currentNamespace !== verifiedNamespace) {
      fencedGenerations.set(
        verifiedNamespace,
        fencedGenerations.get(verifiedNamespace) ?? snapshot.generation,
      )
    }
  }

  async function reactivateRevokedNamespace(
    verified: AuthAccount,
    namespace: string,
  ): Promise<void> {
    // Preserve the device's enabled/disabled preference across reactivation.
    let preservedEnabled: boolean | null = null
    try {
      preservedEnabled = (await persisted.readEnabledPref?.(namespace)) ?? null
    } catch {
      preservedEnabled = null
    }
    // Finish deletion of old revoked payloads first.
    try {
      await persisted.finishRevokedDeletion?.(namespace)
    } catch {
      setSnapshot({ ...snapshot, cleanupError: 'cleanup-failed' })
    }
    // Increment generation + reset dataRevision/lease for the new empty
    // lifecycle, then clear the revocation marker last.
    let nextGeneration = bumpGeneration(namespace) + 1
    try {
      const reset = await persisted.resetLifecycle?.(namespace)
      if (reset && typeof reset.generation === 'number') {
        nextGeneration = reset.generation
        fencedGenerations.set(namespace, nextGeneration)
      } else {
        fencedGenerations.set(namespace, nextGeneration)
      }
    } catch {
      fencedGenerations.set(namespace, nextGeneration)
      setSnapshot({ ...snapshot, cleanupError: 'cleanup-failed' })
    }
    // Only clear the marker after the new empty lifecycle is ready.
    // (Enabled pref is preserved by the repository layer; this lifecycle
    // intentionally does not flip it.)
    void preservedEnabled
    clearRevokedMarker(namespace, options.storage)
    markerValueForCurrent = null
    setSnapshot({
      ...snapshot,
      account: verified,
      session: 'verified',
      namespace,
      generation: nextGeneration,
      invalidated: false,
      lastVerifiedAt: now(),
    })
    try {
      writeLastAccount(verified)
    } catch {
      // Ignore.
    }
    broadcast({
      type: 'catalog-changed',
      namespace,
      generation: nextGeneration,
    })
  }

  function handleConfirmedSignedOut(): void {
    const leavingNamespace = snapshot.namespace
    if (leavingNamespace) {
      // Write the marker synchronously before async deletion.
      fenceNamespaceSync(leavingNamespace)
      broadcast({
        type: 'revoked',
        namespace: leavingNamespace,
        generation: currentGeneration(),
      })
      void deletePersistedOrFence(leavingNamespace, currentGeneration())
    }
    // Local revocation even if cleanup fails; remove last-account snapshot.
    safeClearLastAccount()
    clearQueryMemory()
    setSnapshot({
      ...snapshot,
      account: null,
      session: 'signed-out',
      namespace: null,
      invalidated: false,
      lastVerifiedAt: null,
    })
  }

  /**
   * Account switch A -> B. Synchronously stops rendering A (generation bump
   *
   * - Query abort/clear force consumers to drop A), fences A via marker +
   *   generation, clears persisted A data, then mounts B. Never reuses
   *   singleton query results across the switch.
   */
  async function switchToAccount(
    next: AuthAccount,
    nextNamespace: string,
    prevNamespace: string,
  ): Promise<void> {
    // Synchronously stop rendering A: abort A requests + drop query memory
    // before any B render. The provider remounts account content on
    // `account.id` key change; generation fencing rejects late A commits.
    try {
      switchAbortController?.abort()
    } catch {
      // Ignore.
    }
    switchAbortController = new AbortController()
    clearQueryMemory()
    const fenced = fenceNamespaceSync(prevNamespace)
    broadcast({
      type: 'revoked',
      namespace: prevNamespace,
      generation: fenced.generation,
    })
    // Clear A persisted data (fenced even on physical-delete failure).
    await deletePersistedOrFence(prevNamespace, fenced.generation)
    if (disposed) return
    // Then mount B's read context. B's marker must be absent (fresh login);
    // if B was previously revoked, reactivate through the verified path.
    if (hasRevokedMarker(nextNamespace, options.storage)) {
      await reactivateRevokedNamespace(next, nextNamespace)
      return
    }
    const nextGeneration =
      fencedGenerations.get(nextNamespace) ?? snapshot.generation
    fencedGenerations.set(nextNamespace, nextGeneration)
    setSnapshot({
      ...snapshot,
      account: next,
      session: 'verified',
      namespace: nextNamespace,
      generation: nextGeneration,
      invalidated: false,
      lastVerifiedAt: now(),
    })
    safeWriteLastAccount(next)
  }

  /**
   * Successful sign-out (server-confirmed). Local revocation runs even if
   * cleanup fails; last-account is removed; queries + worker memory cleared;
   * caller navigates out. Offline sign-out is NOT introduced: callers must gate
   * on connectivity and show "Connect to sign out" when unreachable.
   */
  async function signOut(signOutOptions?: {
    navigateTo?: string
  }): Promise<void> {
    const leavingNamespace = snapshot.namespace
    if (leavingNamespace) {
      const fenced = fenceNamespaceSync(leavingNamespace)
      broadcast({
        type: 'revoked',
        namespace: leavingNamespace,
        generation: fenced.generation,
      })
      await deletePersistedOrFence(leavingNamespace, fenced.generation)
    }
    safeClearLastAccount()
    clearQueryMemory()
    try {
      switchAbortController?.abort()
    } catch {
      // Ignore.
    }
    setSnapshot({
      ...snapshot,
      account: null,
      session: 'signed-out',
      namespace: null,
      invalidated: false,
      lastVerifiedAt: null,
    })
    try {
      const navigate = options.navigate
      if (signOutOptions?.navigateTo !== undefined) {
        if (signOutOptions.navigateTo !== '')
          navigate?.(signOutOptions.navigateTo)
      } else {
        navigate?.('/')
      }
    } catch {
      // Navigation failures must not restore the session.
    }
  }

  /** Cross-tab `revoked`/`cleared` fences this tab without trusting payloads. */
  function handleCrossTabEvent(event: OfflineChannelEvent): void {
    if (disposed) return
    if (
      event.type !== 'revoked' &&
      event.type !== 'cleared' &&
      event.type !== 'storage-close'
    ) {
      return
    }
    const currentNamespace = snapshot.namespace
    if (!currentNamespace || event.namespace !== currentNamespace) return
    if (event.generation < currentGeneration()) return
    // Fence + drop memory. Mark invalidated so stale Better Auth hook data
    // cannot repopulate last-account; only a fresh verified session clears it.
    fencedGenerations.set(
      currentNamespace,
      Math.max(event.generation, currentGeneration()),
    )
    clearQueryMemory()
    if (event.type === 'revoked' || event.type === 'cleared') {
      safeClearLastAccount()
      setSnapshot({
        ...snapshot,
        generation: Math.max(event.generation, snapshot.generation),
        invalidated: true,
        // Keep the in-memory account for read-only display until verification
        // resolves, but session drops to offline-identity (never verified).
        session: snapshot.account ? 'offline-identity' : 'signed-out',
      })
    } else {
      // storage-close: other tabs should close/reload IDB handles; retain
      // reads but fence future commits via the bumped generation.
      setSnapshot({
        ...snapshot,
        generation: Math.max(event.generation, snapshot.generation),
      })
    }
  }

  /** On focus, recheck the control record even if messages were missed. */
  async function recheckOnFocus(): Promise<void> {
    const namespace = snapshot.namespace
    if (!namespace) return
    if (hasRevokedMarker(namespace, options.storage)) {
      handleCrossTabEvent({
        type: 'revoked',
        namespace,
        generation: currentGeneration() + 1,
        nonce: newEventUuid(randomUUID),
      })
      return
    }
    if (!persisted.readControl) return
    try {
      const control = await persisted.readControl(namespace)
      if (control?.revoked) {
        handleCrossTabEvent({
          type: 'revoked',
          namespace,
          generation: Math.max(control.generation, currentGeneration() + 1),
          nonce: newEventUuid(randomUUID),
        })
      } else if (
        control &&
        typeof control.generation === 'number' &&
        control.generation > currentGeneration()
      ) {
        fencedGenerations.set(namespace, control.generation)
        setSnapshot({ ...snapshot, generation: control.generation })
      }
    } catch {
      // Recheck failures keep current reads; verification resolves next.
    }
  }

  /**
   * Cold start: local restore displays first, then the same 8s-bounded session
   * verification resolves `checking` without an unbounded loading branch. The
   * restore is local and fast; verification is the network leg — starting
   * verification immediately after the synchronous display keeps the cached
   * identity visible with no server mutation until verification (the observable
   * behavior required by "concurrently"). A fully concurrent `Promise.all`
   * would let verification's signed-out overwrite a not-yet- displayed restore,
   * so restore-then-verify ordering is intentional.
   */
  async function bootstrap(): Promise<void> {
    if (bootstrapped || disposed) return
    bootstrapped = true
    const { account, namespace } = await restoreOfflineIdentity()
    if (disposed) return
    if (account && namespace) {
      // Display the cached identity immediately while verification runs.
      // No server mutation runs until verification (callers gate writes on
      // `verified`; sync gates commits on generation + revision).
      if (!snapshot.account) {
        setSnapshot({
          ...snapshot,
          account,
          namespace,
          session: 'checking',
          generation: fencedGenerations.get(namespace) ?? snapshot.generation,
        })
      }
    } else if (!snapshot.account && snapshot.session === 'checking') {
      // No cached identity: verification decides signed-out vs verified.
      // Keep `checking` until it resolves (bounded by 8s inside).
    }
    await runVerification()
    if (disposed) return
  }

  function notifyAuthError(error: unknown): void {
    if (isForbiddenError(error)) return
    if (!shouldVerifySessionOnError(error)) return
    void runVerification()
  }

  function getSnapshot(): LifecycleSnapshot {
    return snapshot
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  function dispose(): void {
    disposed = true
    try {
      verifyAbortController?.abort()
    } catch {
      // Ignore.
    }
    try {
      switchAbortController?.abort()
    } catch {
      // Ignore.
    }
    listeners.clear()
  }

  /** Test-only: reset fencing + session without touching storage. */
  function resetForTests(): void {
    fencedGenerations.clear()
    markerValueForCurrent = null
    lastCleanupFailure = null
    bootstrapped = false
    disposed = false
    snapshot = {
      account: null,
      session: 'checking',
      namespace: null,
      generation: 0,
      cleanupError: null,
      invalidated: false,
      lastVerifiedAt: null,
      verifyAttempt: 0,
    }
    emit()
  }

  /**
   * Retry the last failed durable cleanup (sign-out/switch fencing already ran
   * synchronously). Clears `cleanupError` on success so menu/settings Retry has
   * a real recovery path instead of a dead button.
   */
  async function retryCleanup(): Promise<boolean> {
    const failed = lastCleanupFailure
    if (!failed || !persisted.deleteNamespace) return false
    try {
      await persisted.deleteNamespace(failed.namespace, failed.generation)
      lastCleanupFailure = null
      if (snapshot.cleanupError === 'cleanup-failed') {
        setSnapshot({ ...snapshot, cleanupError: null })
      }
      return true
    } catch {
      // Still fenced; keep the failure visible.
      return false
    }
  }

  return {
    subscribe,
    getSnapshot,
    bootstrap,
    verifySession: runVerification,
    notifyAuthError,
    handleVerifiedAccount,
    handleConfirmedSignedOut,
    switchToAccount,
    signOut,
    retryCleanup,
    handleCrossTabEvent,
    recheckOnFocus,
    restoreOfflineIdentity,
    reactivateRevokedNamespace,
    dispose,
    resetForTests,
    getAbortSignal: () => switchAbortController?.signal ?? null,
  }
}

export type OfflineLifecycle = ReturnType<typeof createOfflineLifecycle>

/** Write eligibility for the write guard: verified + reachable. */
export function isWriteEligible(input: {
  session: SessionState
  transport: TransportState
}): boolean {
  return input.session === 'verified' && input.transport === 'reachable'
}

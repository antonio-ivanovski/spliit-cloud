import { useSyncExternalStore } from 'react'

import { getApiBaseUrl } from '@/lib/api-url'
import { isNetworkError } from '@/lib/network-error'

/**
 * Central transport + recovery-probe store.
 *
 * Owns the `transport` dimension (`unknown | reachable | unreachable`) and a
 * distinct `serverFailure` dimension (HTTP 5xx or captive-portal HTML is a
 * server response, not proof of offline). User cancellation / account-switch
 * aborts never set offline; bounded timeouts and genuine network failures do.
 *
 * Recovery probes call `GET {apiBaseUrl}/health/liveness` with
 * `cache:'no-store'` and a 5s bound, validating JSON `{status:'ok'}` plus a
 * JSON content-type to reject captive portals. A successful probe enables
 * session verification (lifecycle), never writes directly. Probes run on
 * `online` events, visible foreground, explicit retry, and 5/15/30/60s backoff
 * while visible + navigator online. Only one probe runs at a time and probes
 * bypass the offline guard (plain `fetch`, never disabled by the same offline
 * state they repair).
 *
 * `useOnlineStatus()` is a compatibility projection of this store, not a second
 * latch. Local IndexedDB queries must use `networkMode:'always'`; probe/auth
 * fetches here always run.
 */

export type TransportState = 'unknown' | 'reachable' | 'unreachable'

export type ServerFailure =
  | { kind: 'http-error'; status: number; at: number }
  | { kind: 'portal'; at: number }
  | null

export type ConnectivitySnapshot = {
  transport: TransportState
  serverFailure: ServerFailure
  probeInFlight: boolean
  lastProbeAt: number | null
  probeAttempt: number
}

export const HEALTH_TIMEOUT_MS = 5000
export const PROBE_BACKOFF_MS = [5000, 15000, 30000, 60000]

export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const name = 'name' in error ? String((error as { name: unknown }).name) : ''
  if (name === 'AbortError' || name === 'TimeoutError') return true
  const code = 'code' in error ? (error as { code: unknown }).code : undefined
  // DOM abort code.
  if (code === 20) return true
  return false
}

/** True for genuine connectivity loss. Aborts and HTTP statuses are not. */
export function isTransportFailure(error: unknown): boolean {
  if (error === undefined || error === null) return false
  if (isAbortError(error)) return false
  return isNetworkError(error)
}

export function buildHealthUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/health/liveness`
}

export function isJsonContentType(contentType: string | null): boolean {
  if (!contentType) return false
  return contentType.toLowerCase().includes('application/json')
}

/** Validate the liveness shape to reject captive-portal HTML. */
export function isValidHealthPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false
  return (payload as { status?: unknown }).status === 'ok'
}

export type ConnectivityStoreOptions = {
  fetchFn?: typeof fetch
  getBaseUrl?: () => string
  now?: () => number
  probeTimeoutMs?: number
  backoffMs?: number[]
  isNavigatorOnline?: () => boolean
  isVisible?: () => boolean
  onTransportChange?: (transport: TransportState) => void
}

type WindowEvents = {
  addEventListener: typeof window.addEventListener
  removeEventListener: typeof window.removeEventListener
}

function getWindowEvents(): WindowEvents | null {
  if (typeof window === 'undefined') return null
  if (typeof window.addEventListener !== 'function') return null
  return window
}

export function createConnectivityStore(options?: ConnectivityStoreOptions) {
  const fetchFn = options?.fetchFn ?? ((...args) => fetch(...args))
  const getBaseUrl = options?.getBaseUrl ?? getApiBaseUrl
  const now = options?.now ?? Date.now
  const probeTimeoutMs = options?.probeTimeoutMs ?? HEALTH_TIMEOUT_MS
  const backoffMs = options?.backoffMs ?? PROBE_BACKOFF_MS
  const isNavigatorOnline =
    options?.isNavigatorOnline ??
    (() =>
      typeof navigator === 'undefined' ? true : navigator.onLine !== false)
  const isVisible =
    options?.isVisible ??
    (() =>
      typeof document === 'undefined'
        ? true
        : document.visibilityState === 'visible')

  const listeners = new Set<() => void>()
  let snapshot: ConnectivitySnapshot = {
    transport: 'unknown',
    serverFailure: null,
    probeInFlight: false,
    lastProbeAt: null,
    probeAttempt: 0,
  }
  let started = false
  let disposed = false
  let backoffTimer: ReturnType<typeof setTimeout> | null = null
  let inFlightProbe: Promise<boolean> | null = null
  let inFlightController: AbortController | null = null
  let events: WindowEvents | null = null

  function emit() {
    for (const listener of listeners) listener()
  }

  function setSnapshot(next: ConnectivitySnapshot) {
    const changed =
      next.transport !== snapshot.transport ||
      next.serverFailure !== snapshot.serverFailure ||
      next.probeInFlight !== snapshot.probeInFlight ||
      next.lastProbeAt !== snapshot.lastProbeAt ||
      next.probeAttempt !== snapshot.probeAttempt
    snapshot = next
    if (changed) {
      try {
        options?.onTransportChange?.(next.transport)
      } catch {
        // Transport notifications must never break state.
      }
      emit()
    }
  }

  function setTransport(transport: TransportState) {
    if (snapshot.transport === transport) return
    setSnapshot({ ...snapshot, transport })
  }

  function setServerFailure(serverFailure: ServerFailure) {
    setSnapshot({ ...snapshot, serverFailure })
  }

  function clearBackoffTimer() {
    if (backoffTimer !== null) {
      clearTimeout(backoffTimer)
      backoffTimer = null
    }
  }

  /** Genuine network failure → unreachable. Aborts / HTTP errors ignored. */
  function reportNetworkFailure(error?: unknown): boolean {
    if (error !== undefined && !isTransportFailure(error)) return false
    if (snapshot.transport === 'unreachable') return true
    setTransport('unreachable')
    return true
  }

  function reportNetworkSuccess(): void {
    // Any resolved fetch proving connectivity clears the unreachable latch.
    // HTTP statuses are handled separately via reportServerResponse; a plain
    // success also clears a stale server failure (e.g. transient 503 healed).
    if (snapshot.transport !== 'reachable' || snapshot.serverFailure !== null) {
      setSnapshot({ ...snapshot, transport: 'reachable', serverFailure: null })
    }
  }

  /** Bounded request timeout counts as unreachable (not a user abort). */
  function reportTimeout(): void {
    setTransport('unreachable')
  }

  /** User cancellation / account-switch abort: never sets offline. */
  function reportUserAbort(): void {
    // Intentional no-op. Exists so call sites document the distinction.
  }

  /**
   * HTTP 5xx is a server response, not proof of offline. Records a distinct
   * server failure and keeps transport reachable (the server answered). HTTP
   * 4xx is a normal client/auth response (401 for anonymous, 403/404 on
   * guards): the server answered, so mark reachable and clear any stale failure
   * instead of showing outage UI. Snapshots are retained; status UI renders
   * distinct copy.
   */
  function reportServerResponse(status: number): void {
    if (!Number.isInteger(status) || status < 400 || status > 599) return
    if (status < 500) {
      // Client error: server is reachable, not unavailable.
      if (
        snapshot.transport !== 'reachable' ||
        snapshot.serverFailure !== null
      ) {
        setSnapshot({
          ...snapshot,
          transport: 'reachable',
          serverFailure: null,
        })
      }
      return
    }
    if (snapshot.transport !== 'reachable') {
      setSnapshot({
        ...snapshot,
        transport: 'reachable',
        serverFailure: { kind: 'http-error', status, at: now() },
      })
      return
    }
    setServerFailure({ kind: 'http-error', status, at: now() })
  }

  function reportPortal(): void {
    setSnapshot({
      ...snapshot,
      transport: 'reachable',
      serverFailure: { kind: 'portal', at: now() },
    })
  }

  function clearServerFailure(): void {
    if (snapshot.serverFailure !== null) setServerFailure(null)
  }

  async function probeOnce(signal?: AbortSignal): Promise<boolean> {
    if (inFlightProbe) return inFlightProbe
    if (signal?.aborted) return false
    setSnapshot({ ...snapshot, probeInFlight: true })
    const controller = new AbortController()
    inFlightController = controller
    const onExternalAbort = () =>
      controller.abort(new DOMException('Aborted', 'AbortError'))
    signal?.addEventListener('abort', onExternalAbort, { once: true })

    const timeoutId = setTimeout(() => {
      controller.abort(new DOMException('Probe timeout', 'TimeoutError'))
    }, probeTimeoutMs)
    if (typeof timeoutId === 'object' && 'unref' in timeoutId) {
      ;(timeoutId as { unref?: () => void }).unref?.()
    }

    const task = (async () => {
      try {
        const response = await fetchFn(buildHealthUrl(getBaseUrl()), {
          method: 'GET',
          cache: 'no-store',
          signal: controller.signal,
        })
        const contentType = response.headers?.get?.('content-type') ?? null
        if (!response.ok) {
          // HTTP error with a response: server failure, not offline.
          reportServerResponse(response.status)
          return false
        }
        if (!isJsonContentType(contentType)) {
          reportPortal()
          return false
        }
        let payload: unknown = null
        try {
          payload = await response.json()
        } catch {
          reportPortal()
          return false
        }
        if (!isValidHealthPayload(payload)) {
          reportPortal()
          return false
        }
        // Valid liveness enables session verification, not writes.
        setSnapshot({
          ...snapshot,
          transport: 'reachable',
          serverFailure: null,
          lastProbeAt: now(),
          probeAttempt: 0,
        })
        clearBackoffTimer()
        return true
      } catch (error) {
        if (controller.signal.aborted && signal?.aborted) {
          // Explicit user/switch abort: do not set offline.
          return false
        }
        if (isAbortError(error)) {
          // Bounded probe timeout counts as unreachable unless the caller
          // aborted first (handled above).
          setTransport('unreachable')
          return false
        }
        if (isTransportFailure(error)) {
          setTransport('unreachable')
          return false
        }
        // Unknown fetch failure: conservatively mark unreachable only for
        // network-like errors; HTTP-like errors are handled above.
        return false
      } finally {
        clearTimeout(timeoutId)
        signal?.removeEventListener('abort', onExternalAbort)
        inFlightController = null
        inFlightProbe = null
        setSnapshot({ ...snapshot, probeInFlight: false })
      }
    })()
    inFlightProbe = task
    return task
  }

  function scheduleBackoff(): void {
    clearBackoffTimer()
    if (!started || disposed) return
    if (!isNavigatorOnline()) return
    if (!isVisible()) return
    if (snapshot.transport !== 'unreachable') return
    const delay =
      backoffMs[Math.min(snapshot.probeAttempt, backoffMs.length - 1)] ?? 60000
    backoffTimer = setTimeout(() => {
      backoffTimer = null
      if (!started || disposed) return
      if (!isNavigatorOnline()) return
      if (!isVisible()) return
      if (snapshot.transport !== 'unreachable') return
      setSnapshot({ ...snapshot, probeAttempt: snapshot.probeAttempt + 1 })
      void probeOnce().then((ok) => {
        if (!ok) scheduleBackoff()
      })
    }, delay)
    if (typeof backoffTimer === 'object' && 'unref' in backoffTimer) {
      ;(backoffTimer as { unref?: () => void }).unref?.()
    }
  }

  function handleOnline() {
    // Browser `online` is a hint, not proof. Hide offline UI optimistically
    // (unknown reads as online) while a validating probe confirms; a failed
    // probe returns to `unreachable` and re-shows offline UI.
    clearServerFailure()
    if (snapshot.transport === 'unreachable') {
      setSnapshot({ ...snapshot, transport: 'unknown' })
    }
    void probeOnce().then((ok) => {
      if (!ok) scheduleBackoff()
    })
  }

  function handleOffline() {
    // Browser explicitly offline: mark unreachable immediately and stop
    // periodic probes. Skip hanging waits elsewhere (lifecycle checks
    // `navigator.onLine === false` before awaiting verification).
    abortInFlightProbe()
    clearBackoffTimer()
    setTransport('unreachable')
  }

  function handleVisibility() {
    if (!isVisible()) {
      clearBackoffTimer()
      return
    }
    // Visible foreground revalidates even without an `online` event
    // (false-positive navigator.online, missed events, captive portal
    // clearing). Only probe when we are currently unreachable.
    if (snapshot.transport === 'unreachable' && isNavigatorOnline()) {
      void probeOnce().then((ok) => {
        if (!ok) scheduleBackoff()
      })
    }
  }

  function handleFocus() {
    handleVisibility()
  }

  function abortInFlightProbe() {
    try {
      inFlightController?.abort(new DOMException('Aborted', 'AbortError'))
    } catch {
      // Ignore abort failures.
    }
  }

  /** Idempotent: repeated `start()` never registers duplicate listeners. */
  function start(): void {
    if (started || disposed) return
    started = true
    events = getWindowEvents()
    if (events) {
      events.addEventListener('online', handleOnline)
      events.addEventListener('offline', handleOffline)
      // `document` may be undefined in node tests; guard each.
      if (
        typeof document !== 'undefined' &&
        typeof document.addEventListener === 'function'
      ) {
        document.addEventListener('visibilitychange', handleVisibility)
      }
      events.addEventListener('focus', handleFocus)
    }
    // If we start while already unreachable + visible + online, begin the
    // 5/15/30/60s backoff loop. Otherwise probes trigger from events/retry.
    scheduleBackoff()
  }

  function stop(): void {
    if (!started) return
    started = false
    clearBackoffTimer()
    abortInFlightProbe()
    if (events) {
      events.removeEventListener('online', handleOnline)
      events.removeEventListener('offline', handleOffline)
      if (
        typeof document !== 'undefined' &&
        typeof document.removeEventListener === 'function'
      ) {
        document.removeEventListener('visibilitychange', handleVisibility)
      }
      events.removeEventListener('focus', handleFocus)
    }
    events = null
  }

  function dispose(): void {
    disposed = true
    stop()
    listeners.clear()
  }

  /** Explicit Retry: bypasses backoff once, never disabled by offline state. */
  function retryNow(signal?: AbortSignal): Promise<boolean> {
    clearBackoffTimer()
    return probeOnce(signal).then((ok) => {
      if (!ok) scheduleBackoff()
      return ok
    })
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  function getSnapshot(): ConnectivitySnapshot {
    return snapshot
  }

  function isOnline(): boolean {
    return snapshot.transport !== 'unreachable'
  }

  /** Test-only: reset transport/failure/backoff without touching listeners. */
  function resetForTests(): void {
    clearBackoffTimer()
    abortInFlightProbe()
    inFlightProbe = null
    setSnapshot({
      transport: 'unknown',
      serverFailure: null,
      probeInFlight: false,
      lastProbeAt: null,
      probeAttempt: 0,
    })
  }

  return {
    subscribe,
    getSnapshot,
    isOnline,
    start,
    stop,
    dispose,
    probeOnce,
    retryNow,
    reportNetworkFailure,
    reportNetworkSuccess,
    reportTimeout,
    reportUserAbort,
    reportServerResponse,
    reportPortal,
    clearServerFailure,
    resetForTests,
    isStarted: () => started,
  }
}

export type ConnectivityStore = ReturnType<typeof createConnectivityStore>

let defaultStore: ConnectivityStore | null = null

export function getDefaultConnectivityStore(): ConnectivityStore {
  if (!defaultStore) {
    defaultStore = createConnectivityStore()
    // The shared store owns navigator listeners even without a provider so
    // `useOnlineStatus()` stays a pure projection (no second latch). `start`
    // is idempotent; the provider's start/stop pairing never duplicates.
    try {
      defaultStore.start()
    } catch {
      // Ignore listener failures intgl node tests without a window.
    }
  }
  return defaultStore
}

/** Test-only: drop the singleton so cases start from `unknown`. */
export function resetDefaultConnectivityStoreForTests(): void {
  try {
    defaultStore?.dispose()
  } catch {
    // Ignore teardown failures.
  }
  defaultStore = null
}

/**
 * Compatibility projection for `useOnlineStatus()`. Reads the shared store plus
 * a synchronous `navigator.onLine` hint so a freshly-set `navigator.onLine ===
 * false` reports offline even before the store's `offline` event fires.
 * False-positive `navigator.onLine === true` still reports offline while
 * transport is `unreachable`.
 */
export function useConnectivityOnlineStatus(
  store?: ConnectivityStore,
): boolean {
  const target = store ?? getDefaultConnectivityStore()
  const snapshot = useSyncExternalStore(
    target.subscribe,
    target.getSnapshot,
    target.getSnapshot,
  )
  const browserOnline =
    typeof navigator === 'undefined' ? true : navigator.onLine !== false
  return browserOnline && snapshot.transport !== 'unreachable'
}

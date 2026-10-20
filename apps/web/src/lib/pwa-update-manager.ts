import {
  GET_PWA_BUILD,
  PWA_BUILD,
  pwaBuildSchema,
  type PwaBuild,
} from '@/lib/pwa-build'
import {
  clearExpenseUpdateSnapshot,
  PWA_RECOVERY_EVENT,
  PWA_UPDATE_RECEIPT_KEY,
  readUpdateReceipt,
  writeUpdateReceipt,
} from '@/lib/pwa-expense-recovery'
import {
  registerPwaServiceWorker,
  type PwaServiceWorkerContainer,
} from '@/lib/pwa-service-worker'
import {
  hasPwaUpdateBlockers,
  hasHardPwaUpdateBlockers,
  checkpointPwaUpdateWork,
  isPwaUpdateProtectionInitialized,
  subscribePwaUpdateBlockers,
} from '@/lib/pwa-update-blockers'
import {
  asCoordinationResult,
  asProtocolMessage,
  COORDINATION_ABORTED,
  COORDINATION_CONFIRM,
  COORDINATION_CONFIRM_RESPONSE,
  COORDINATION_PREPARE,
  COORDINATION_PREPARE_RESPONSE,
  PWA_UPDATE_AUTH_EXPIRY_MS,
  PWA_UPDATE_PROTOCOL_VERSION,
  PWA_UPDATE_REQUEST_TIMEOUT_MS,
  PWA_UPDATE_COUNTDOWN_MS,
  REQUEST_COORDINATED_ACTIVATION,
  type CoordinationResult,
} from '@/lib/pwa-update-protocol'
import {
  clearRestartScrollState,
  readRestartScrollState,
  restoreRestartScroll,
} from '@/lib/pwa-update-recovery'

export const PWA_UPDATE_RESTART_KEY = 'spliit-pwa-update-restart'
export const PWA_UPDATE_RESTART_STATE_KEY = 'spliit-pwa-update-restart-state'
export const PWA_ASSET_ERROR_EVENT = 'spliit:pwa-asset-error'
/** Asset-error reloads stop retrying after this many attempts per session. */
export const PWA_ASSET_ERROR_MAX_RELOADS = 2
const PWA_ASSET_ERROR_COUNT_KEY = 'spliit-pwa-asset-error-count'

const DEFAULT_ACTIVATION_TIMEOUT_MS = 10_000
const DEFAULT_RETRY_INTERVAL_MS = 15_000

export type PwaUpdateSnapshot =
  | { status: 'hidden' }
  | { status: 'failed'; dismissed: boolean }
  | { status: 'blocked'; version?: string }
  | { status: 'countdown'; version?: string; seconds: number }
  | { status: 'applying' }
  | { status: 'restoring' }
  | { status: 'recovery-failed' }
  | { status: 'updated'; version: string; restored: boolean }

type ReloadCause = 'controller-change' | 'asset-error'
type RetryOperation =
  | { type: 'activate'; worker: ServiceWorker }
  | { type: 'reload'; cause: ReloadCause; worker?: ServiceWorker }

type PwaUpdateLifecycle =
  | { status: 'idle' }
  | { status: 'waiting'; worker: ServiceWorker }
  | { status: 'coordinating'; worker: ServiceWorker }
  | { status: 'activating'; worker: ServiceWorker }
  | { status: 'reload-pending'; cause: ReloadCause; worker?: ServiceWorker }
  | { status: 'reloading'; retry: RetryOperation }
  | { status: 'failed'; retry: RetryOperation; dismissed: boolean }

type Timer = ReturnType<typeof globalThis.setTimeout>

type PwaUpdateManagerOptions = {
  enabled?: boolean
  serviceWorker?: PwaServiceWorkerContainer
  registerServiceWorker?: (
    container: PwaServiceWorkerContainer,
  ) => Promise<ServiceWorkerRegistration>
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
  reload?: () => void
  setTimeout?: typeof globalThis.setTimeout
  clearTimeout?: typeof globalThis.clearTimeout
  activationTimeoutMs?: number
  clientCheckTimeoutMs?: number
  retryIntervalMs?: number
  createMessageChannel?: () => MessageChannel
  now?: () => number
  hasBlockers?: () => boolean
  isProtectionReady?: () => boolean
  subscribeBlockers?: (listener: () => void) => () => void
  subscribeVisibility?: (listener: () => void) => () => void
  subscribeWindowFocus?: (listener: () => void) => () => void
  subscribeOnline?: (listener: () => void) => () => void
  subscribeAssetErrors?: (listener: () => void) => () => void
  isVisible?: () => boolean
  readScroll?: () => { x: number; y: number }
  currentUrl?: () => string
}

export type PwaUpdateManager = {
  checkForUpdate: () => Promise<void>
  updateNow: () => void
  getSnapshot: () => PwaUpdateSnapshot
  subscribe: (listener: () => void) => () => void
  retry: () => void
  dismissFailure: () => void
  dispose: () => void
}

function safeSetRestartMarker(
  storage: PwaUpdateManagerOptions['storage'],
  enabled: boolean,
) {
  try {
    if (enabled) storage?.setItem(PWA_UPDATE_RESTART_KEY, '1')
    else storage?.removeItem(PWA_UPDATE_RESTART_KEY)
  } catch {
    // Storage can be unavailable in privacy modes. Reloading still works.
  }
}

function recoverRestartScroll(
  options: PwaUpdateManagerOptions,
  storage: PwaUpdateManagerOptions['storage'],
): void {
  if (typeof window === 'undefined') return
  let restart: { url: string; x: number; y: number } | null = null
  try {
    restart = readRestartScrollState(storage, PWA_UPDATE_RESTART_STATE_KEY)
  } catch {
    return
  }
  if (!restart) return
  try {
    clearRestartScrollState(storage, PWA_UPDATE_RESTART_STATE_KEY)
  } catch {
    // Best-effort cleanup only.
  }
  const current =
    options.currentUrl?.() ??
    window.location.pathname + window.location.search + window.location.hash
  if (restart.url !== current || (restart.x <= 0 && restart.y <= 0)) return
  const target = { x: restart.x, y: restart.y }
  const begin = () => {
    void restoreRestartScroll(
      {
        readPosition: () => ({ x: window.scrollX, y: window.scrollY }),
        readMaxScroll: () => ({
          maxX: document.documentElement.scrollWidth - window.innerWidth,
          maxY: document.documentElement.scrollHeight - window.innerHeight,
        }),
        writePosition: (x, y) => window.scrollTo(x, y),
        currentUrl: () => current,
        requestFrame: (fn) => requestAnimationFrame(fn),
        onUserScroll: (listener) => {
          const opts = { passive: true, once: true } as AddEventListenerOptions
          window.addEventListener('wheel', listener, opts)
          window.addEventListener('touchmove', listener, opts)
          window.addEventListener('keydown', listener, opts)
          return () => {
            window.removeEventListener('wheel', listener)
            window.removeEventListener('touchmove', listener)
            window.removeEventListener('keydown', listener)
          }
        },
      },
      target,
    ).catch(() => {})
  }
  if (document.readyState !== 'complete') {
    window.addEventListener('load', begin, { once: true })
  } else {
    begin()
  }
}

export function createPwaUpdateManager(
  options: PwaUpdateManagerOptions = {},
): PwaUpdateManager {
  const enabled = options.enabled ?? import.meta.env.PROD
  const serviceWorker =
    options.serviceWorker ??
    (typeof navigator !== 'undefined' && 'serviceWorker' in navigator
      ? (navigator.serviceWorker as PwaServiceWorkerContainer)
      : undefined)
  const register = options.registerServiceWorker ?? registerPwaServiceWorker
  const storage =
    options.storage ??
    (() => {
      try {
        return sessionStorage
      } catch {
        return undefined
      }
    })()
  const reload = options.reload ?? (() => window.location.reload())
  const schedule = options.setTimeout ?? globalThis.setTimeout.bind(globalThis)
  const cancel =
    options.clearTimeout ?? globalThis.clearTimeout.bind(globalThis)
  const now = options.now ?? Date.now
  const hasBlockers = options.hasBlockers ?? hasPwaUpdateBlockers
  const hasHardBlockers = options.hasBlockers ?? hasHardPwaUpdateBlockers
  const isReady = options.isProtectionReady ?? isPwaUpdateProtectionInitialized
  const subscribeBlockers =
    options.subscribeBlockers ?? subscribePwaUpdateBlockers
  const isVisible =
    options.isVisible ??
    (() =>
      typeof document === 'undefined' || document.visibilityState === 'visible')

  const defaultVisibilitySubscription = (listener: () => void) => {
    if (typeof document === 'undefined') return () => {}
    document.addEventListener('visibilitychange', listener)
    return () => document.removeEventListener('visibilitychange', listener)
  }
  const defaultWindowSubscription = (
    type: 'focus' | 'online',
    listener: () => void,
  ) => {
    if (typeof window === 'undefined') return () => {}
    window.addEventListener(type, listener)
    return () => window.removeEventListener(type, listener)
  }
  const defaultAssetErrorSubscription = (listener: () => void) => {
    if (typeof window === 'undefined') return () => {}
    const onAssetError = (event: Event) => {
      event.preventDefault()
      listener()
    }
    window.addEventListener(PWA_ASSET_ERROR_EVENT, onAssetError)
    return () => window.removeEventListener(PWA_ASSET_ERROR_EVENT, onAssetError)
  }

  const readAssetErrorCount = (): number => {
    try {
      return Number.parseInt(
        storage?.getItem?.(PWA_ASSET_ERROR_COUNT_KEY) ?? '0',
        10,
      )
    } catch {
      return 0
    }
  }
  const writeAssetErrorCount = (count: number): void => {
    try {
      storage?.setItem?.(PWA_ASSET_ERROR_COUNT_KEY, String(count))
    } catch {
      // Storage can be unavailable in privacy modes; the in-memory
      // lifecycle still bounds retries within this boot.
    }
  }

  let lifecycle: PwaUpdateLifecycle = { status: 'idle' }
  let snapshot: PwaUpdateSnapshot = { status: 'hidden' }
  let registration: ServiceWorkerRegistration | undefined
  let currentController = serviceWorker?.controller ?? null
  let reloadAuthorization:
    | {
        attemptId: string
        worker: ServiceWorker
        workerToken: string
        recordedAt: number
      }
    | undefined
  let disposed = false
  let activationTimer: Timer | undefined
  let retryTimer: Timer | undefined
  let periodicTimer: Timer | undefined
  let cancelCoordination: (() => void) | undefined
  let registrationPromise:
    | Promise<ServiceWorkerRegistration | undefined>
    | undefined
  let targetBuild: PwaBuild | undefined
  let targetRecoveryVersion: number | undefined
  let unansweredAttempts = 0
  let countdown:
    | {
        attemptId: string
        worker: ServiceWorker
        finish: () => void
        deadline: number
      }
    | undefined
  let countdownTimer: Timer | undefined
  let unlock: (() => void) | undefined
  let activeAttemptId: string | undefined
  let recoveryError = false
  let peerBlocked = false
  let restoring = false
  let dismissedStall = false
  const cleanup = new Set<() => void>()
  const installingWorkers = new Map<ServiceWorker, () => void>()
  const listeners = new Set<() => void>()

  const publish = (next: PwaUpdateSnapshot) => {
    if (JSON.stringify(next) === JSON.stringify(snapshot)) return
    snapshot = next
    listeners.forEach((listener) => listener())
  }

  const syncSnapshot = () => {
    if (recoveryError) return publish({ status: 'recovery-failed' })
    if (restoring) return publish({ status: 'restoring' })
    if (countdown)
      return publish({
        status: 'countdown',
        version: targetBuild?.version,
        seconds: Math.max(0, Math.ceil((countdown.deadline - now()) / 1000)),
      })
    if (lifecycle.status === 'failed')
      return publish({ status: 'failed', dismissed: lifecycle.dismissed })
    if (lifecycle.status === 'waiting' || lifecycle.status === 'coordinating') {
      if (hasHardBlockers() || peerBlocked)
        return publish({ status: 'blocked', version: targetBuild?.version })
      if (unansweredAttempts >= 3)
        return publish({ status: 'failed', dismissed: dismissedStall })
    }
    if (
      unlock ||
      lifecycle.status === 'activating' ||
      lifecycle.status === 'reloading'
    )
      return publish({ status: 'applying' })
    publish({ status: 'hidden' })
  }

  const releaseHandoff = (clear = true) => {
    clearActivationTimer()
    if (countdownTimer !== undefined) cancel(countdownTimer)
    countdownTimer = undefined
    countdown = undefined
    unlock?.()
    unlock = undefined
    reloadAuthorization = undefined
    activeAttemptId = undefined
    if (clear && storage && !restoring && !readUpdateReceipt(storage)?.recovery)
      clearExpenseUpdateSnapshot(storage)
  }

  const lockHandoff = () => {
    if (unlock || typeof document === 'undefined') return
    const root = document.getElementById('root')
    if (!root) return
    const wasInert = root.inert
    root.inert = true
    unlock = () => {
      root.inert = wasInert
    }
  }

  const clearActivationTimer = () => {
    if (activationTimer === undefined) return
    cancel(activationTimer)
    activationTimer = undefined
  }

  const clearPeriodicTimer = () => {
    if (periodicTimer === undefined) return
    cancel(periodicTimer)
    periodicTimer = undefined
  }

  const schedulePeriodicRetry = () => {
    clearPeriodicTimer()
    if (
      disposed ||
      (lifecycle.status !== 'waiting' && lifecycle.status !== 'reload-pending')
    )
      return
    periodicTimer = schedule(() => {
      periodicTimer = undefined
      if (!disposed && isVisible()) reconcile()
      schedulePeriodicRetry()
    }, options.retryIntervalMs ?? DEFAULT_RETRY_INTERVAL_MS)
  }

  const setLifecycle = (next: PwaUpdateLifecycle) => {
    lifecycle = next
    syncSnapshot()
    schedulePeriodicRetry()
  }

  const fail = (retry: RetryOperation) => {
    clearActivationTimer()
    releaseHandoff()
    safeSetRestartMarker(storage, false)
    setLifecycle({ status: 'failed', retry, dismissed: false })
  }

  const armActivationTimer = (retry: RetryOperation) => {
    clearActivationTimer()
    activationTimer = schedule(
      () => fail(retry),
      options.activationTimeoutMs ?? DEFAULT_ACTIVATION_TIMEOUT_MS,
    )
  }

  const isBlocked = () =>
    restoring ||
    (recoveryError &&
      Boolean(storage && readUpdateReceipt(storage)?.recovery)) ||
    !isReady() ||
    hasHardBlockers()

  const saveRestartState = (): void => {
    // Route/search survive via location.reload itself; persist the scroll
    // offset so boot recovery can restore it after data renders.
    try {
      const readScroll =
        options.readScroll ?? (() => ({ x: window.scrollX, y: window.scrollY }))
      const url =
        options.currentUrl?.() ??
        (typeof window === 'undefined'
          ? ''
          : window.location.pathname +
            window.location.search +
            window.location.hash)
      const scroll = readScroll()
      storage?.setItem?.(
        PWA_UPDATE_RESTART_STATE_KEY,
        JSON.stringify({ url, x: scroll.x, y: scroll.y, at: now() }),
      )
    } catch {
      // Best-effort: the reload still preserves route/search.
    }
  }

  const reloadNow = (
    operation: Extract<RetryOperation, { type: 'reload' }>,
  ) => {
    if (disposed || lifecycle.status === 'reloading') return
    setLifecycle({ status: 'reloading', retry: operation })
    safeSetRestartMarker(storage, true)
    saveRestartState()
    armActivationTimer(operation)
    try {
      reload()
    } catch {
      fail(operation)
    }
  }

  const takeMatchingAuthorization = (worker: ServiceWorker) => {
    const authorization = reloadAuthorization
    reloadAuthorization = undefined
    return Boolean(
      authorization &&
      authorization.worker === worker &&
      now() - authorization.recordedAt <= PWA_UPDATE_AUTH_EXPIRY_MS,
    )
  }

  const requestCoordinatedActivation = (
    worker: ServiceWorker,
  ): Promise<CoordinationResult | null> =>
    new Promise((resolve) => {
      let channel: MessageChannel
      try {
        channel = options.createMessageChannel?.() ?? new MessageChannel()
      } catch {
        resolve(null)
        return
      }
      let settled = false
      let timeout: Timer | undefined
      const finish = (result: CoordinationResult | null) => {
        if (settled) return
        settled = true
        if (timeout !== undefined) cancel(timeout)
        channel.port1.close()
        if (cancelCoordination === abort) cancelCoordination = undefined
        resolve(result)
      }
      const abort = () => finish(null)
      cancelCoordination = abort
      timeout = schedule(
        abort,
        options.clientCheckTimeoutMs ?? PWA_UPDATE_REQUEST_TIMEOUT_MS,
      )
      channel.port1.onmessage = (event: MessageEvent<unknown>) =>
        finish(asCoordinationResult(event.data))
      try {
        worker.postMessage(
          {
            type: REQUEST_COORDINATED_ACTIVATION,
            protocol: PWA_UPDATE_PROTOCOL_VERSION,
          },
          [channel.port2],
        )
      } catch {
        finish(null)
      }
    })

  const coordinate = async (worker: ServiceWorker) => {
    setLifecycle({ status: 'coordinating', worker })
    const result = await requestCoordinatedActivation(worker)
    if (
      disposed ||
      lifecycle.status !== 'coordinating' ||
      lifecycle.worker !== worker
    )
      return
    if (!result) {
      unansweredAttempts++
      releaseHandoff()
      setLifecycle({ status: 'waiting', worker })
      return
    }
    if (!result.activated) {
      if (result.reason === 'busy') {
        setLifecycle({ status: 'waiting', worker })
        return
      }
      releaseHandoff()
      peerBlocked = result.reason === 'peer-blocked'
      unansweredAttempts =
        result.reason === 'peer-missing' ? unansweredAttempts + 1 : 0
      if (result.reason === 'activation-failed') {
        fail({ type: 'activate', worker })
      } else {
        setLifecycle({ status: 'waiting', worker })
      }
      return
    }
    setLifecycle({ status: 'activating', worker })
    armActivationTimer({ type: 'activate', worker })
  }

  function reconcile() {
    if (disposed || countdown || unlock) return
    if (lifecycle.status === 'waiting') {
      if (isBlocked() || (hasBlockers() && targetRecoveryVersion !== 1)) {
        syncSnapshot()
        return
      }
      void coordinate(registration?.waiting ?? lifecycle.worker)
      return
    }
    if (lifecycle.status === 'reload-pending') {
      if (isBlocked() || hasBlockers()) return
      reloadNow({
        type: 'reload',
        cause: lifecycle.cause,
        ...(lifecycle.worker ? { worker: lifecycle.worker } : {}),
      })
    }
  }

  const readWaitingBuild = (worker: ServiceWorker): Promise<void> =>
    new Promise((resolve) => {
      const channel = options.createMessageChannel?.() ?? new MessageChannel()
      let done = false
      const finish = () => {
        if (done) return
        done = true
        cancel(timer)
        channel.port1.close()
        cleanup.delete(finish)
        resolve()
      }
      const timer = schedule(finish, options.clientCheckTimeoutMs ?? 1500)
      channel.port1.onmessage = (event: MessageEvent<unknown>) => {
        const result = pwaBuildSchema.safeParse(event.data)
        if (!disposed && registration?.waiting === worker && result.success) {
          targetBuild = result.data
          targetRecoveryVersion = (event.data as { recoveryVersion?: number })
            .recoveryVersion
        }
        finish()
      }
      cleanup.add(finish)
      try {
        worker.postMessage({ type: GET_PWA_BUILD }, [channel.port2])
      } catch {
        finish()
      }
    })

  const queueWaitingWorker = (worker: ServiceWorker) => {
    if (lifecycle.status === 'reloading') return
    if (
      (lifecycle.status === 'waiting' ||
        lifecycle.status === 'coordinating' ||
        lifecycle.status === 'activating') &&
      lifecycle.worker === worker
    )
      return
    releaseHandoff()
    targetBuild = undefined
    targetRecoveryVersion = undefined
    unansweredAttempts = 0
    dismissedStall = false
    peerBlocked = false
    setLifecycle({ status: 'waiting', worker })
    void readWaitingBuild(worker)
      .catch(() => {})
      .then(() => {
        if (!disposed) {
          syncSnapshot()
          reconcile()
        }
      })
  }

  const observeInstallingWorker = (worker: ServiceWorker | null) => {
    if (!worker || installingWorkers.has(worker)) return
    const onStateChange = () => {
      if (worker.state !== 'installed') return
      if (currentController) queueWaitingWorker(registration?.waiting ?? worker)
      const remove = installingWorkers.get(worker)
      remove?.()
      installingWorkers.delete(worker)
    }
    worker.addEventListener('statechange', onStateChange)
    const remove = () =>
      worker.removeEventListener('statechange', onStateChange)
    installingWorkers.set(worker, remove)
    if (worker.state === 'installed') onStateChange()
  }

  const onControllerChange = () => {
    const next = serviceWorker?.controller ?? null
    if (!next || next === currentController) return
    if (!currentController) {
      currentController = next
      return
    }
    currentController = next
    clearActivationTimer()
    const authorized = takeMatchingAuthorization(next)
    const operation: Extract<RetryOperation, { type: 'reload' }> = {
      type: 'reload',
      cause: 'controller-change',
      worker: next,
    }
    setLifecycle({
      status: 'reload-pending',
      cause: operation.cause,
      worker: next,
    })
    if (authorized) reloadNow(operation)
    else reconcile()
  }

  const expectedMessageWorker = () => {
    if (
      lifecycle.status === 'waiting' ||
      lifecycle.status === 'coordinating' ||
      lifecycle.status === 'activating'
    )
      return lifecycle.worker
    return registration?.waiting ?? null
  }

  const replyToWorker = (worker: ServiceWorker, message: object) => {
    try {
      worker.postMessage(message)
    } catch {
      // A timed-out coordination round needs no late reply.
    }
  }

  const onServiceWorkerMessage = (event: Event) => {
    if (disposed) return
    const messageEvent = event as MessageEvent
    const header = asProtocolMessage(messageEvent.data)
    const source = messageEvent.source
    if (
      !header ||
      !source ||
      typeof (source as ServiceWorker).postMessage !== 'function' ||
      source !== (expectedMessageWorker() ?? null)
    )
      return
    const worker = source as ServiceWorker
    const data = messageEvent.data as Record<string, unknown>
    const parsedBuild = pwaBuildSchema.safeParse(data.build)
    if (parsedBuild.success) {
      targetBuild = parsedBuild.data
      targetRecoveryVersion = data.recoveryVersion === 1 ? 1 : undefined
    }
    const checkpoint = () => {
      if (isBlocked()) throw new Error('Unfinished work')
      if (!hasBlockers()) return 0
      if (!targetBuild || targetRecoveryVersion !== 1)
        throw new Error('Unsupported recovery')
      return checkpointPwaUpdateWork({
        attemptId: header.attemptId,
        build: targetBuild,
      })
    }
    if (header.type === COORDINATION_PREPARE) {
      // Another window may initiate this round while our own request is pending.
      releaseHandoff()
      activeAttemptId = header.attemptId
      let status = !isReady() ? 'not-ready' : 'blocked'
      try {
        if (isReady()) {
          status = checkpoint() > 0 ? 'recoverable' : 'clean'
          recoveryError = false
        }
      } catch {
        if (!isBlocked()) recoveryError = true
      }
      replyToWorker(worker, {
        type: COORDINATION_PREPARE_RESPONSE,
        protocol: PWA_UPDATE_PROTOCOL_VERSION,
        attemptId: header.attemptId,
        status,
      })
      syncSnapshot()
      return
    }
    if (header.type === COORDINATION_CONFIRM) {
      const workerToken =
        typeof data.workerToken === 'string' ? data.workerToken : ''
      if (activeAttemptId && activeAttemptId !== header.attemptId) return
      activeAttemptId = header.attemptId
      const confirm = () => {
        if (disposed || activeAttemptId !== header.attemptId) return
        if (countdownTimer !== undefined) cancel(countdownTimer)
        countdownTimer = undefined
        countdown = undefined
        let clean = false
        try {
          if (!workerToken) throw new Error('Missing worker token')
          lockHandoff()
          const count = checkpoint()
          if (targetBuild && storage)
            writeUpdateReceipt(
              { build: targetBuild, attemptId: header.attemptId },
              count > 0,
              storage,
            )
          reloadAuthorization = {
            attemptId: header.attemptId,
            worker,
            workerToken,
            recordedAt: now(),
          }
          clean = true
          armActivationTimer({ type: 'activate', worker })
        } catch {
          if (!isBlocked()) recoveryError = true
          releaseHandoff()
        }
        replyToWorker(worker, {
          type: COORDINATION_CONFIRM_RESPONSE,
          protocol: PWA_UPDATE_PROTOCOL_VERSION,
          attemptId: header.attemptId,
          status: clean ? 'confirmed' : 'rejected',
        })
        syncSnapshot()
      }
      if (hasBlockers() && !isBlocked() && isVisible()) {
        countdown = {
          attemptId: header.attemptId,
          worker,
          finish: confirm,
          deadline: now() + PWA_UPDATE_COUNTDOWN_MS,
        }
        const tick = () => {
          if (!countdown) return
          if (isBlocked()) {
            confirm()
            return
          }
          if (now() >= countdown.deadline) {
            confirm()
            return
          }
          try {
            checkpoint()
          } catch {
            recoveryError = true
            confirm()
            return
          }
          syncSnapshot()
          countdownTimer = schedule(
            tick,
            Math.min(1000, countdown.deadline - now()),
          )
        }
        tick()
      } else confirm()
      return
    }
    if (
      header.type === COORDINATION_ABORTED &&
      activeAttemptId === header.attemptId
    ) {
      releaseHandoff()
      syncSnapshot()
    }
  }

  const onUpdateFound = () =>
    observeInstallingWorker(registration?.installing ?? null)

  const subscribeSafely = (subscribe: () => () => void) => {
    try {
      cleanup.add(subscribe())
    } catch {
      // Optional browser signals only accelerate a later retry.
    }
  }

  recoverRestartScroll(options, storage)

  if (enabled && serviceWorker) {
    serviceWorker.addEventListener('controllerchange', onControllerChange)
    serviceWorker.addEventListener('message', onServiceWorkerMessage)
    cleanup.add(() =>
      serviceWorker.removeEventListener('controllerchange', onControllerChange),
    )
    cleanup.add(() =>
      serviceWorker.removeEventListener('message', onServiceWorkerMessage),
    )

    subscribeSafely(() =>
      subscribeBlockers(() => {
        if (retryTimer !== undefined) return
        retryTimer = schedule(() => {
          retryTimer = undefined
          reconcile()
        }, 0)
      }),
    )
    subscribeSafely(() =>
      (options.subscribeVisibility ?? defaultVisibilitySubscription)(reconcile),
    )
    subscribeSafely(() =>
      (
        options.subscribeWindowFocus ??
        ((listener) => defaultWindowSubscription('focus', listener))
      )(reconcile),
    )
    subscribeSafely(() =>
      (
        options.subscribeOnline ??
        ((listener) => defaultWindowSubscription('online', listener))
      )(reconcile),
    )
    subscribeSafely(() =>
      (options.subscribeAssetErrors ?? defaultAssetErrorSubscription)(() => {
        if (
          lifecycle.status === 'reloading' ||
          lifecycle.status === 'reload-pending'
        )
          return
        // Asset-error recovery is separate from update coordination and
        // bounded per tab-session: repeated chunk failures fail visibly
        // (manual Retry stays available) instead of reload-looping.
        // Blockers and idleness still gate the reload: no discarded forms.
        const attempts = readAssetErrorCount()
        if (attempts >= PWA_ASSET_ERROR_MAX_RELOADS) {
          fail({ type: 'reload', cause: 'asset-error' })
          return
        }
        writeAssetErrorCount(attempts + 1)
        setLifecycle({ status: 'reload-pending', cause: 'asset-error' })
        reconcile()
      }),
    )

    // Registration starts once; every discovery check awaits this same promise.
    void ensureRegistration().catch(() => {})
    if (typeof window !== 'undefined') {
      const receipt = storage ? readUpdateReceipt(storage) : null
      if (receipt) {
        if (receipt.recovery) {
          restoring = true
          lockHandoff()
          publish({ status: 'restoring' })
          const timer = schedule(() => {
            if (!restoring) return
            restoring = false
            releaseHandoff(false)
            recoveryError = true
            publish({ status: 'recovery-failed' })
          }, 30_000)
          cleanup.add(() => cancel(timer))
        } else {
          publish({
            status: 'updated',
            version: PWA_BUILD.version,
            restored: false,
          })
          storage?.removeItem(PWA_UPDATE_RECEIPT_KEY)
        }
      }
      const onRecovery = (event: Event) => {
        const success = (event as CustomEvent<{ success: boolean }>).detail
          .success
        restoring = false
        releaseHandoff(false)
        recoveryError = !success
        publish(
          success
            ? { status: 'updated', version: PWA_BUILD.version, restored: true }
            : { status: 'recovery-failed' },
        )
      }
      window.addEventListener(PWA_RECOVERY_EVENT, onRecovery)
      cleanup.add(() =>
        window.removeEventListener(PWA_RECOVERY_EVENT, onRecovery),
      )
    }
  }

  function ensureRegistration(): Promise<
    ServiceWorkerRegistration | undefined
  > {
    if (!enabled || !serviceWorker || disposed)
      return Promise.resolve(undefined)
    if (registrationPromise) return registrationPromise
    registrationPromise = register(serviceWorker)
      .then((next) => {
        if (disposed) return undefined
        registration = next
        next.addEventListener('updatefound', onUpdateFound)
        cleanup.add(() =>
          next.removeEventListener('updatefound', onUpdateFound),
        )
        observeInstallingWorker(next.installing)
        if (next.waiting && currentController) queueWaitingWorker(next.waiting)
        return next
      })
      .catch((error: unknown) => {
        registrationPromise = undefined
        throw error
      })
    return registrationPromise
  }

  return {
    async checkForUpdate() {
      const next = await ensureRegistration()
      if (!next || disposed) return
      await next.update()
      if (!disposed && next.waiting && currentController)
        queueWaitingWorker(next.waiting)
      reconcile()
    },
    updateNow() {
      countdown?.finish()
    },
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    retry() {
      if (
        snapshot.status === 'recovery-failed' &&
        storage &&
        readUpdateReceipt(storage)?.recovery
      ) {
        reload()
        return
      }
      recoveryError = false
      dismissedStall = false
      unansweredAttempts = 0
      if (lifecycle.status !== 'failed') {
        reconcile()
        return
      }
      clearActivationTimer()
      const operation = lifecycle.retry
      if (operation.type === 'activate') {
        setLifecycle({ status: 'waiting', worker: operation.worker })
        reconcile()
      } else {
        setLifecycle({
          status: 'reload-pending',
          cause: operation.cause,
          ...(operation.worker ? { worker: operation.worker } : {}),
        })
        reconcile()
      }
    },
    dismissFailure() {
      dismissedStall = true
      if (lifecycle.status !== 'failed' || lifecycle.dismissed) return
      setLifecycle({ ...lifecycle, dismissed: true })
    },
    dispose() {
      if (disposed) return
      disposed = true
      releaseHandoff(false)
      cleanup.forEach((unsubscribe) => unsubscribe())
      cleanup.clear()
      installingWorkers.forEach((remove) => remove())
      installingWorkers.clear()
      cancelCoordination?.()
      clearActivationTimer()
      clearPeriodicTimer()
      if (retryTimer !== undefined) cancel(retryTimer)
      retryTimer = undefined
      reloadAuthorization = undefined
      listeners.clear()
    },
  }
}

import {
  registerPwaServiceWorker,
  type PwaServiceWorkerContainer,
} from '@/lib/pwa-service-worker'
import {
  hasPwaUpdateBlockers,
  isPwaUpdateProtectionInitialized,
  subscribePwaUpdateBlockers,
} from '@/lib/pwa-update-blockers'
import { subscribeServiceWorkerUpdateChecks } from '@/lib/pwa-update-checks'
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
  REQUEST_COORDINATED_ACTIVATION,
  type CoordinationResult,
} from '@/lib/pwa-update-protocol'

export const PWA_UPDATE_RESTART_KEY = 'spliit-pwa-update-restart'
export const PWA_ASSET_ERROR_EVENT = 'spliit:pwa-asset-error'

const DEFAULT_ACTIVATION_TIMEOUT_MS = 10_000
const DEFAULT_RETRY_INTERVAL_MS = 15_000

export type PwaUpdateSnapshot =
  | { status: 'hidden' }
  | { status: 'failed'; dismissed: boolean }

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
  storage?: Pick<Storage, 'setItem' | 'removeItem'>
  reload?: () => void
  setTimeout?: typeof globalThis.setTimeout
  clearTimeout?: typeof globalThis.clearTimeout
  activationTimeoutMs?: number
  clientCheckTimeoutMs?: number
  retryIntervalMs?: number
  createMessageChannel?: () => MessageChannel
  now?: () => number
  subscribeUpdateChecks?: typeof subscribeServiceWorkerUpdateChecks
  hasBlockers?: () => boolean
  isProtectionReady?: () => boolean
  subscribeBlockers?: (listener: () => void) => () => void
  subscribeVisibility?: (listener: () => void) => () => void
  subscribeWindowFocus?: (listener: () => void) => () => void
  subscribeOnline?: (listener: () => void) => () => void
  subscribeAssetErrors?: (listener: () => void) => () => void
  isVisible?: () => boolean
}

export type PwaUpdateManager = {
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
    (typeof sessionStorage === 'undefined' ? undefined : sessionStorage)
  const reload = options.reload ?? (() => window.location.reload())
  const schedule = options.setTimeout ?? globalThis.setTimeout.bind(globalThis)
  const cancel =
    options.clearTimeout ?? globalThis.clearTimeout.bind(globalThis)
  const now = options.now ?? Date.now
  const hasBlockers = options.hasBlockers ?? hasPwaUpdateBlockers
  const isReady = options.isProtectionReady ?? isPwaUpdateProtectionInitialized
  const subscribeBlockers =
    options.subscribeBlockers ?? subscribePwaUpdateBlockers
  const subscribeChecks =
    options.subscribeUpdateChecks ?? subscribeServiceWorkerUpdateChecks
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
  let unsubscribeChecks: (() => void) | undefined
  const cleanup = new Set<() => void>()
  const installingWorkers = new Map<ServiceWorker, () => void>()
  const listeners = new Set<() => void>()

  const publish = (next: PwaUpdateSnapshot) => {
    if (
      next.status === snapshot.status &&
      (next.status === 'hidden' ||
        (snapshot.status === 'failed' && next.dismissed === snapshot.dismissed))
    )
      return
    snapshot = next
    listeners.forEach((listener) => listener())
  }

  const syncSnapshot = () => {
    if (lifecycle.status === 'failed') {
      publish({ status: 'failed', dismissed: lifecycle.dismissed })
    } else {
      publish({ status: 'hidden' })
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
    if (disposed || lifecycle.status !== 'waiting') return
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

  const isBlocked = () => !isReady() || hasBlockers()

  const reloadNow = (
    operation: Extract<RetryOperation, { type: 'reload' }>,
  ) => {
    if (disposed || lifecycle.status === 'reloading') return
    setLifecycle({ status: 'reloading', retry: operation })
    safeSetRestartMarker(storage, true)
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
      setLifecycle({ status: 'waiting', worker })
      return
    }
    if (!result.activated) {
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
    if (disposed) return
    if (lifecycle.status === 'waiting') {
      if (isBlocked()) return
      void coordinate(registration?.waiting ?? lifecycle.worker)
      return
    }
    if (lifecycle.status === 'reload-pending') {
      if (isBlocked()) return
      reloadNow({
        type: 'reload',
        cause: lifecycle.cause,
        ...(lifecycle.worker ? { worker: lifecycle.worker } : {}),
      })
    }
  }

  const queueWaitingWorker = (worker: ServiceWorker) => {
    reloadAuthorization = undefined
    if (lifecycle.status === 'reloading') return
    setLifecycle({ status: 'waiting', worker })
    reconcile()
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
    if (header.type === COORDINATION_PREPARE) {
      reloadAuthorization = undefined
      replyToWorker(worker, {
        type: COORDINATION_PREPARE_RESPONSE,
        protocol: PWA_UPDATE_PROTOCOL_VERSION,
        attemptId: header.attemptId,
        status: !isReady() ? 'not-ready' : hasBlockers() ? 'blocked' : 'clean',
      })
      return
    }
    if (header.type === COORDINATION_CONFIRM) {
      const data = messageEvent.data as Record<string, unknown>
      const workerToken =
        typeof data.workerToken === 'string' ? data.workerToken : ''
      const clean = workerToken.length > 0 && !isBlocked()
      if (clean) {
        reloadAuthorization = {
          attemptId: header.attemptId,
          worker,
          workerToken,
          recordedAt: now(),
        }
      }
      replyToWorker(worker, {
        type: COORDINATION_CONFIRM_RESPONSE,
        protocol: PWA_UPDATE_PROTOCOL_VERSION,
        attemptId: header.attemptId,
        status: clean ? 'confirmed' : 'rejected',
      })
      return
    }
    if (
      header.type === COORDINATION_ABORTED &&
      reloadAuthorization?.attemptId === header.attemptId &&
      reloadAuthorization.worker === worker
    ) {
      reloadAuthorization = undefined
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
        setLifecycle({ status: 'reload-pending', cause: 'asset-error' })
        reconcile()
      }),
    )

    void register(serviceWorker)
      .then((nextRegistration) => {
        if (disposed) return
        registration = nextRegistration
        nextRegistration.addEventListener('updatefound', onUpdateFound)
        cleanup.add(() =>
          nextRegistration.removeEventListener('updatefound', onUpdateFound),
        )
        observeInstallingWorker(nextRegistration.installing)
        if (nextRegistration.waiting && currentController)
          queueWaitingWorker(nextRegistration.waiting)
        try {
          unsubscribeChecks = subscribeChecks(nextRegistration)
        } catch {
          unsubscribeChecks = undefined
        }
        void Promise.resolve(nextRegistration.update()).catch(() => {})
      })
      .catch(() => {})
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    retry() {
      if (lifecycle.status !== 'failed') return
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
      if (lifecycle.status !== 'failed' || lifecycle.dismissed) return
      setLifecycle({ ...lifecycle, dismissed: true })
    },
    dispose() {
      if (disposed) return
      disposed = true
      unsubscribeChecks?.()
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

let manager: PwaUpdateManager | undefined

export function startPwaUpdateManager(): PwaUpdateManager {
  return (manager ??= createPwaUpdateManager())
}

export function getPwaUpdateManager(): PwaUpdateManager {
  return startPwaUpdateManager()
}

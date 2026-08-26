import { registerSW, type RegisterSWOptions } from 'virtual:pwa-register'

import { subscribeServiceWorkerUpdateChecks } from '@/lib/pwa-update-checks'

export const PWA_UPDATE_RESTART_KEY = 'spliit-pwa-update-restart'

const DEFAULT_SILENT_CHECK_DEADLINE_MS = 250
const DEFAULT_UPDATE_DEADLINE_MS = 5000
const DEFAULT_ACTIVATION_TIMEOUT_MS = 10_000
const CLIENT_CHECK_TIMEOUT_MS = 1000

export type PwaUpdateSnapshot = {
  status: 'checking' | 'current' | 'available' | 'restarting'
  error?: 'registration' | 'restart' | 'client-check'
  checkingClients?: boolean
  otherClientsBlocked?: boolean
  otherClientCount?: number
  forceRestartAvailable?: boolean
}

export type PwaUpdateStage =
  | 'checking'
  | 'downloading'
  | 'checking-clients'
  | 'applying'
  | 'restarting'

type ServiceWorkerContainerLike = Pick<ServiceWorkerContainer, 'controller'> &
  Partial<
    Pick<ServiceWorkerContainer, 'addEventListener' | 'removeEventListener'>
  >

type PwaUpdateManagerOptions = {
  registerSW?: (options?: RegisterSWOptions) => () => Promise<void>
  serviceWorker?: ServiceWorkerContainerLike
  online?: boolean
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
  reload?: () => void
  setTimeout?: typeof window.setTimeout
  clearTimeout?: typeof window.clearTimeout
  silentCheckDeadlineMs?: number
  updateDeadlineMs?: number
  activationTimeoutMs?: number
  clientCheckTimeoutMs?: number
  createMessageChannel?: () => MessageChannel
  subscribeUpdateChecks?: typeof subscribeServiceWorkerUpdateChecks
}

export type PwaUpdateManager = {
  getSnapshot: () => PwaUpdateSnapshot
  getStage: () => PwaUpdateStage
  subscribe: (listener: () => void) => () => void
  waitForLaunch: () => Promise<void>
  restartNow: () => Promise<void>
  forceRestartAll: () => Promise<void>
  deferUntilNextLaunch: () => void
  dispose: () => void
}

type ActivationResponse =
  | { status: 'accepted' }
  | { status: 'blocked'; clientCount: number }

function safeSetRestartMarker(
  storage: PwaUpdateManagerOptions['storage'],
  enabled: boolean,
) {
  try {
    if (enabled) storage?.setItem(PWA_UPDATE_RESTART_KEY, '1')
    else storage?.removeItem(PWA_UPDATE_RESTART_KEY)
  } catch {
    // Storage can be unavailable in privacy modes. The update still works;
    // only the restart presentation falls back to the browser default.
  }
}

export function createPwaUpdateManager(
  options: PwaUpdateManagerOptions = {},
): PwaUpdateManager {
  const register = options.registerSW ?? registerSW
  const serviceWorker =
    options.serviceWorker ??
    (typeof navigator !== 'undefined' && 'serviceWorker' in navigator
      ? navigator.serviceWorker
      : undefined)
  const online =
    options.online ??
    (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean'
      ? navigator.onLine
      : true)
  const storage =
    options.storage ??
    (typeof sessionStorage === 'undefined' ? undefined : sessionStorage)
  const reload = options.reload ?? (() => window.location.reload())
  const schedule =
    options.setTimeout ??
    (globalThis.setTimeout.bind(globalThis) as typeof window.setTimeout)
  const cancel =
    options.clearTimeout ??
    (globalThis.clearTimeout.bind(globalThis) as typeof window.clearTimeout)
  const subscribeChecks =
    options.subscribeUpdateChecks ?? subscribeServiceWorkerUpdateChecks

  let snapshot: PwaUpdateSnapshot = { status: 'checking' }
  let stage: PwaUpdateStage = 'checking'
  let registration: ServiceWorkerRegistration | undefined
  let updateFoundRegistration: ServiceWorkerRegistration | undefined
  let unsubscribeChecks: (() => void) | undefined
  let launchTimer: number | undefined
  let activationTimer: number | undefined
  let cancelClientCheck: (() => void) | undefined
  let disposed = false
  let deferred = false
  let launchWindowOpen = true
  let launchSettled = false
  let reloadStarted = false
  let restartCheckInFlight = false
  let controllerRequiresReload = false
  let updateAvailableSignaled = false
  let updateDetected = false
  let currentController = serviceWorker?.controller ?? null
  const listeners = new Set<() => void>()

  let resolveLaunch!: () => void
  const launchPromise = new Promise<void>((resolve) => {
    resolveLaunch = resolve
  })

  const publish = (next: PwaUpdateSnapshot) => {
    snapshot = next
    listeners.forEach((listener) => listener())
  }

  const publishStage = (next: PwaUpdateStage) => {
    if (stage === next) return
    stage = next
    listeners.forEach((listener) => listener())
  }

  const settleLaunch = () => {
    if (launchSettled) return
    launchSettled = true
    resolveLaunch()
  }

  const clearLaunchTimer = () => {
    if (launchTimer === undefined) return
    cancel(launchTimer)
    launchTimer = undefined
  }

  const finishLaunchWithoutUpdate = () => {
    if (launchSettled || updateDetected) return
    launchWindowOpen = false
    clearLaunchTimer()
    if (snapshot.status === 'checking') publish({ status: 'current' })
    settleLaunch()
  }

  const keepLaunchOpenForUpdate = () => {
    // The update budget is absolute from the first concrete signal. Repeated
    // `updatefound`/Workbox callbacks must not keep extending the splash.
    if (updateDetected) return
    updateDetected = true
    if (launchSettled || !launchWindowOpen) return
    clearLaunchTimer()
    launchTimer = schedule(() => {
      launchWindowOpen = false
      launchTimer = undefined
      if (snapshot.status === 'checking') publish({ status: 'current' })
      settleLaunch()
    }, options.updateDeadlineMs ?? DEFAULT_UPDATE_DEADLINE_MS)
  }

  const onUpdateFound = () => {
    // A first installation has no old application shell to replace and must
    // never delay or reload its first page load.
    if (!currentController || !registration?.installing) return
    keepLaunchOpenForUpdate()
    publishStage('downloading')
  }

  const failRestart = () => {
    if (disposed) return
    if (activationTimer !== undefined) cancel(activationTimer)
    activationTimer = undefined
    reloadStarted = false
    safeSetRestartMarker(storage, false)
    publish({
      status: 'available',
      error: 'restart',
      ...(!controllerRequiresReload && registration?.waiting
        ? { forceRestartAvailable: true }
        : {}),
    })
    settleLaunch()
  }

  const scheduleRestartFailure = () => {
    if (activationTimer !== undefined) cancel(activationTimer)
    activationTimer = schedule(
      failRestart,
      options.activationTimeoutMs ?? DEFAULT_ACTIVATION_TIMEOUT_MS,
    )
  }

  const reloadForUpdate = () => {
    // Every caller runs after the new worker has taken control. If navigation
    // is blocked or throws, a retry must reload this controller directly;
    // there may no longer be a waiting worker to message.
    controllerRequiresReload = true
    if (disposed || reloadStarted) return
    reloadStarted = true
    cancelClientCheck?.()
    scheduleRestartFailure()
    safeSetRestartMarker(storage, true)
    publishStage('restarting')
    publish({ status: 'restarting' })
    try {
      reload()
    } catch {
      reloadStarted = false
      failRestart()
    }
  }

  const onControllerChange = () => {
    const nextController = serviceWorker?.controller ?? null
    if (!nextController || nextController === currentController) return
    if (!currentController) {
      currentController = nextController
      return
    }
    currentController = nextController
    reloadForUpdate()
  }

  serviceWorker?.addEventListener?.('controllerchange', onControllerChange)

  const requestSoleClientActivation = async (
    target: ServiceWorker,
  ): Promise<ActivationResponse | null> => {
    return await new Promise<ActivationResponse | null>((resolve) => {
      let channel: MessageChannel
      try {
        channel = options.createMessageChannel?.() ?? new MessageChannel()
      } catch {
        resolve(null)
        return
      }
      let settled = false
      let timeout: number | undefined
      const finish = (response: ActivationResponse | null) => {
        if (settled) return
        settled = true
        if (timeout !== undefined) cancel(timeout)
        try {
          channel.port1.close()
        } catch {
          // A partial MessageChannel implementation should still fail safe.
        }
        if (cancelClientCheck === cancelRequest) cancelClientCheck = undefined
        resolve(response)
      }
      const cancelRequest = () => finish(null)
      cancelClientCheck = cancelRequest
      timeout = schedule(
        cancelRequest,
        options.clientCheckTimeoutMs ?? CLIENT_CHECK_TIMEOUT_MS,
      )

      channel.port1.onmessage = (event: MessageEvent<unknown>) => {
        if (settled) return
        const data = event.data
        const response: ActivationResponse | null =
          data &&
          typeof data === 'object' &&
          'status' in data &&
          data.status === 'accepted'
            ? { status: 'accepted' }
            : data &&
                typeof data === 'object' &&
                'status' in data &&
                data.status === 'blocked' &&
                'clientCount' in data &&
                typeof data.clientCount === 'number' &&
                Number.isSafeInteger(data.clientCount) &&
                data.clientCount > 1
              ? { status: 'blocked', clientCount: data.clientCount }
              : null
        finish(response)
      }

      try {
        target.postMessage({ type: 'ACTIVATE_UPDATE_IF_SOLE_CLIENT' }, [
          channel.port2,
        ])
      } catch {
        finish(null)
      }
    })
  }

  const beginRestart = () => {
    if (disposed || reloadStarted || snapshot.status === 'restarting') return
    publishStage('applying')
    publish({ status: 'restarting' })
    safeSetRestartMarker(storage, true)
    scheduleRestartFailure()
  }

  const tryRestart = async (automatic: boolean) => {
    if (
      disposed ||
      reloadStarted ||
      snapshot.status === 'restarting' ||
      restartCheckInFlight
    )
      return
    if (controllerRequiresReload) {
      reloadForUpdate()
      return
    }
    const target = registration?.waiting
    if (!target) {
      publish({
        status: 'available',
        error: 'client-check',
        otherClientsBlocked: true,
      })
      settleLaunch()
      return
    }
    if (automatic && !launchWindowOpen) {
      publish({ status: 'available' })
      settleLaunch()
      return
    }

    restartCheckInFlight = true
    try {
      publishStage('checking-clients')
      publish({ status: 'available', checkingClients: true })
      const response = await requestSoleClientActivation(target)
      if (disposed || reloadStarted) return
      if (!response) {
        publish({
          status: 'available',
          error: 'client-check',
          otherClientsBlocked: true,
        })
        settleLaunch()
        return
      }
      if (response.status === 'blocked') {
        publish({
          status: 'available',
          otherClientsBlocked: true,
          otherClientCount: response.clientCount - 1,
        })
        settleLaunch()
        return
      }
      beginRestart()
    } finally {
      restartCheckInFlight = false
    }
  }

  const onUpdateAvailable = () => {
    updateAvailableSignaled = true
    keepLaunchOpenForUpdate()
    if (disposed || deferred || !registration?.waiting) return
    if (snapshot.status === 'restarting') return
    void tryRestart(true)
  }

  const failRegistration = () => {
    if (disposed || snapshot.status !== 'checking') return
    launchWindowOpen = false
    clearLaunchTimer()
    publish({ status: 'current', error: 'registration' })
    settleLaunch()
  }

  const registerUpdateWorker = () => {
    try {
      register({
        immediate: true,
        onNeedRefresh: onUpdateAvailable,
        onNeedReload: reloadForUpdate,
        onRegisteredSW(_url, nextRegistration) {
          if (disposed || !nextRegistration) return
          registration = nextRegistration
          updateFoundRegistration?.removeEventListener(
            'updatefound',
            onUpdateFound,
          )
          updateFoundRegistration = nextRegistration
          nextRegistration.addEventListener('updatefound', onUpdateFound)
          unsubscribeChecks?.()
          try {
            unsubscribeChecks = subscribeChecks(nextRegistration)
          } catch {
            unsubscribeChecks = undefined
          }
          if (nextRegistration.installing) onUpdateFound()
          if (nextRegistration.waiting || updateAvailableSignaled)
            onUpdateAvailable()
          void Promise.resolve()
            .then(() => nextRegistration.update())
            .then(() => {
              if (
                nextRegistration.installing ||
                nextRegistration.waiting ||
                updateAvailableSignaled
              )
                return
              finishLaunchWithoutUpdate()
            })
            .catch(failRegistration)
        },
        onRegisterError: failRegistration,
      })
    } catch {
      failRegistration()
    }
  }

  if (!serviceWorker) {
    launchWindowOpen = false
    publish({ status: 'current' })
    settleLaunch()
  } else {
    // Offline launches should never wait, but registration must still run so
    // an existing worker is retained and online/visibility checks resume.
    if (!online) {
      launchWindowOpen = false
      publish({ status: 'current' })
      settleLaunch()
    } else {
      launchTimer = schedule(() => {
        launchTimer = undefined
        finishLaunchWithoutUpdate()
      }, options.silentCheckDeadlineMs ?? DEFAULT_SILENT_CHECK_DEADLINE_MS)
    }
    registerUpdateWorker()
  }

  return {
    getSnapshot: () => snapshot,
    getStage: () => stage,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    waitForLaunch: () => launchPromise,
    restartNow: () => tryRestart(false),
    async forceRestartAll() {
      if (disposed || snapshot.status === 'restarting' || restartCheckInFlight)
        return
      const target = registration?.waiting
      if (!target) {
        publish({ status: 'available', error: 'restart' })
        settleLaunch()
        return
      }
      beginRestart()
      try {
        target.postMessage({ type: 'SKIP_WAITING' })
      } catch {
        failRestart()
      }
    },
    deferUntilNextLaunch() {
      // Once the waiting worker is performing the atomic count-and-activate
      // operation, dismissal cannot reliably cancel it.
      if (snapshot.status === 'restarting' || restartCheckInFlight) return
      deferred = true
      publish({ status: 'current' })
      settleLaunch()
    },
    dispose() {
      disposed = true
      unsubscribeChecks?.()
      clearLaunchTimer()
      if (activationTimer !== undefined) cancel(activationTimer)
      cancelClientCheck?.()
      updateFoundRegistration?.removeEventListener('updatefound', onUpdateFound)
      serviceWorker?.removeEventListener?.(
        'controllerchange',
        onControllerChange,
      )
      listeners.clear()
      settleLaunch()
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

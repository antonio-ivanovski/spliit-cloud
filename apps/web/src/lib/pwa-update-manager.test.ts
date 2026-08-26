import type { RegisterSWOptions } from 'vite-plugin-pwa/types'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createPwaUpdateManager } from './pwa-update-manager'

type ActivationBehavior = 'accepted' | 'blocked' | 'timeout' | 'throw'
type Harness = ReturnType<typeof createHarness>

function createHarness(
  options: {
    activation?: ActivationBehavior
    forceFailure?: boolean
    initialController?: boolean
    waiting?: boolean
    online?: boolean
    registerThrows?: boolean
    updateFailure?: boolean
    updatePending?: boolean
    updateThrows?: boolean
    createMessageChannel?: () => MessageChannel
  } = {},
) {
  let callbacks: RegisterSWOptions = {}
  let waiting = options.waiting ?? false
  let controller = options.initialController === false ? null : {}
  const controllerEvents = new EventTarget()
  const registrationEvents = new EventTarget()
  let installing = false
  const reload = vi.fn()
  const storage = {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  }
  const waitingWorker = {
    postMessage: vi.fn(
      (message: { type?: string }, transfer?: Transferable[]) => {
        if (message.type === 'SKIP_WAITING') {
          if (options.forceFailure) throw new Error('force message failed')
          return
        }
        if (message.type !== 'ACTIVATE_UPDATE_IF_SOLE_CLIENT') return
        if (options.activation === 'throw') throw new Error('message failed')
        if (options.activation === 'timeout') return
        const port = transfer?.[0] as MessagePort | undefined
        port?.postMessage(
          options.activation === 'blocked'
            ? { status: 'blocked', clientCount: 2 }
            : { status: 'accepted' },
        )
      },
    ),
  } as unknown as ServiceWorker
  const registration = {
    get installing() {
      return installing ? ({} as ServiceWorker) : null
    },
    get waiting() {
      return waiting ? waitingWorker : null
    },
    active: {} as ServiceWorker,
    update: options.updateThrows
      ? vi.fn(() => {
          throw new Error('registration removed')
        })
      : options.updateFailure
        ? vi.fn().mockRejectedValue(new Error('offline'))
        : options.updatePending
          ? vi.fn(() => new Promise(() => {}))
          : vi.fn().mockResolvedValue(undefined),
    addEventListener:
      registrationEvents.addEventListener.bind(registrationEvents),
    removeEventListener:
      registrationEvents.removeEventListener.bind(registrationEvents),
  } as unknown as ServiceWorkerRegistration
  const subscribeUpdateChecks = vi.fn(() => vi.fn())
  const registerSW = vi.fn((nextCallbacks: RegisterSWOptions = {}) => {
    if (options.registerThrows) throw new Error('registration unavailable')
    callbacks = nextCallbacks
    return vi.fn().mockResolvedValue(undefined)
  })
  const serviceWorker = {
    get controller() {
      return controller as ServiceWorker | null
    },
    addEventListener: controllerEvents.addEventListener.bind(controllerEvents),
    removeEventListener:
      controllerEvents.removeEventListener.bind(controllerEvents),
  }
  const manager = createPwaUpdateManager({
    registerSW,
    serviceWorker,
    storage,
    reload,
    online: options.online,
    createMessageChannel: options.createMessageChannel,
    subscribeUpdateChecks,
  })

  return {
    callbacks: () => callbacks,
    manager,
    registration,
    reload,
    storage,
    waitingWorker,
    subscribeUpdateChecks,
    setWaiting(next: boolean) {
      waiting = next
      if (next) installing = false
    },
    triggerUpdateFound() {
      installing = true
      registrationEvents.dispatchEvent(new Event('updatefound'))
    },
    changeController(next: object = {}) {
      controller = next
      controllerEvents.dispatchEvent(new Event('controllerchange'))
    },
  }
}

async function register(harness: Harness) {
  harness.callbacks().onRegisteredSW?.('/sw.js', harness.registration)
  await Promise.resolve()
}

async function waitForSnapshot(
  harness: Harness,
  expected: ReturnType<Harness['manager']['getSnapshot']>,
) {
  await vi.waitFor(() => {
    expect(harness.manager.getSnapshot()).toEqual(expected)
  })
}

describe('createPwaUpdateManager', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('fails open immediately when service workers are unavailable', async () => {
    const manager = createPwaUpdateManager({
      serviceWorker: undefined,
      online: false,
    })

    await manager.waitForLaunch()
    expect(manager.getSnapshot()).toEqual({ status: 'current' })
  })

  it('renders offline immediately but still registers for later checks', async () => {
    const harness = createHarness({ online: false })

    await harness.manager.waitForLaunch()
    expect(harness.manager.getSnapshot()).toEqual({ status: 'current' })
    expect(harness.callbacks().immediate).toBe(true)

    await register(harness)
    expect(harness.subscribeUpdateChecks).toHaveBeenCalledWith(
      harness.registration,
    )
  })

  it('fails open when registration throws synchronously', async () => {
    const harness = createHarness({ registerThrows: true })

    await harness.manager.waitForLaunch()
    expect(harness.manager.getSnapshot()).toEqual({
      status: 'current',
      error: 'registration',
    })
  })

  it('activates an already-waiting update and reloads on controllerchange', async () => {
    const harness = createHarness({ waiting: true })
    await register(harness)
    await waitForSnapshot(harness, { status: 'restarting' })

    expect(harness.manager.getStage()).toBe('applying')

    expect(harness.waitingWorker.postMessage).toHaveBeenCalledWith(
      { type: 'ACTIVATE_UPDATE_IF_SOLE_CLIENT' },
      expect.any(Array),
    )

    harness.changeController()
    harness.callbacks().onNeedReload?.()

    expect(harness.manager.getStage()).toBe('restarting')
    expect(harness.reload).toHaveBeenCalledOnce()
    expect(harness.storage.setItem).toHaveBeenCalledWith(
      'spliit-pwa-update-restart',
      '1',
    )
  })

  it('does not reload when the first service worker takes control', async () => {
    const harness = createHarness({ initialController: false })
    await register(harness)

    harness.changeController()

    expect(harness.reload).not.toHaveBeenCalled()
  })

  it('reloads a non-initiating tab when its existing controller changes', async () => {
    const harness = createHarness()
    await register(harness)

    harness.changeController()

    expect(harness.reload).toHaveBeenCalledOnce()
    expect(harness.storage.setItem).toHaveBeenCalledWith(
      'spliit-pwa-update-restart',
      '1',
    )
  })

  it('still reloads when session storage is unavailable', async () => {
    const harness = createHarness()
    harness.storage.setItem.mockImplementation(() => {
      throw new Error('storage unavailable')
    })
    await register(harness)

    harness.changeController()

    expect(harness.reload).toHaveBeenCalledOnce()
  })

  it('renders as soon as the update check reports the app is current', async () => {
    const harness = createHarness()
    await register(harness)

    await harness.manager.waitForLaunch()
    expect(harness.manager.getSnapshot()).toEqual({ status: 'current' })
  })

  it('fails open after a brief silent deadline when the check is slow', async () => {
    vi.useFakeTimers()
    const harness = createHarness({ updatePending: true })
    await register(harness)

    await vi.advanceTimersByTimeAsync(250)
    await harness.manager.waitForLaunch()
    expect(harness.manager.getSnapshot()).toEqual({ status: 'current' })
  })

  it('shows download progress and grants a detected update five seconds', async () => {
    vi.useFakeTimers()
    const harness = createHarness({ updatePending: true })
    await register(harness)

    harness.triggerUpdateFound()
    expect(harness.manager.getStage()).toBe('downloading')

    await vi.advanceTimersByTimeAsync(4999)
    expect(harness.manager.getSnapshot()).toEqual({ status: 'checking' })

    await vi.advanceTimersByTimeAsync(1)
    await harness.manager.waitForLaunch()
    expect(harness.manager.getSnapshot()).toEqual({ status: 'current' })
  })

  it('does not extend the update deadline for repeated lifecycle signals', async () => {
    vi.useFakeTimers()
    const harness = createHarness({ updatePending: true })
    await register(harness)

    harness.triggerUpdateFound()
    await vi.advanceTimersByTimeAsync(4000)
    harness.callbacks().onNeedRefresh?.()
    await vi.advanceTimersByTimeAsync(1000)

    await harness.manager.waitForLaunch()
    expect(harness.manager.getSnapshot()).toEqual({ status: 'current' })
  })

  it('offers an update that finishes after the silent launch deadline', async () => {
    vi.useFakeTimers()
    const harness = createHarness({ updatePending: true })
    await register(harness)
    await vi.advanceTimersByTimeAsync(250)

    harness.setWaiting(true)
    harness.callbacks().onNeedRefresh?.()

    expect(harness.manager.getSnapshot()).toEqual({ status: 'available' })
    expect(harness.waitingWorker.postMessage).not.toHaveBeenCalled()
  })

  it('blocks safe activation while another Spliit window is open', async () => {
    const harness = createHarness({ waiting: true, activation: 'blocked' })
    await register(harness)
    await waitForSnapshot(harness, {
      status: 'available',
      otherClientsBlocked: true,
      otherClientCount: 1,
    })

    expect(harness.manager.getStage()).toBe('checking-clients')
    expect(harness.reload).not.toHaveBeenCalled()
  })

  it('fails safely when the waiting worker cannot verify clients', async () => {
    vi.useFakeTimers()
    const harness = createHarness({ waiting: true, activation: 'timeout' })
    await register(harness)
    await vi.advanceTimersByTimeAsync(1000)

    expect(harness.manager.getSnapshot()).toEqual({
      status: 'available',
      error: 'client-check',
      otherClientsBlocked: true,
    })
  })

  it('fails safely when MessageChannel is unavailable', async () => {
    const harness = createHarness({
      waiting: true,
      createMessageChannel: () => {
        throw new Error('MessageChannel unavailable')
      },
    })
    await register(harness)

    await waitForSnapshot(harness, {
      status: 'available',
      error: 'client-check',
      otherClientsBlocked: true,
    })
  })

  it('deduplicates activation checks and cannot defer one in flight', async () => {
    vi.useFakeTimers()
    const harness = createHarness({ waiting: true, activation: 'timeout' })
    await register(harness)
    expect(harness.manager.getSnapshot()).toEqual({
      status: 'available',
      checkingClients: true,
    })

    void harness.manager.restartNow()
    harness.manager.deferUntilNextLaunch()

    expect(harness.waitingWorker.postMessage).toHaveBeenCalledTimes(1)
    expect(harness.manager.getSnapshot()).toEqual({
      status: 'available',
      checkingClients: true,
    })

    harness.manager.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('force restarts by messaging the waiting worker directly', async () => {
    const harness = createHarness({ waiting: true, activation: 'blocked' })
    await register(harness)
    await waitForSnapshot(harness, {
      status: 'available',
      otherClientsBlocked: true,
      otherClientCount: 1,
    })

    await harness.manager.forceRestartAll()

    expect(harness.manager.getSnapshot()).toEqual({ status: 'restarting' })
    expect(harness.waitingWorker.postMessage).toHaveBeenLastCalledWith({
      type: 'SKIP_WAITING',
    })
    harness.changeController()
    expect(harness.reload).toHaveBeenCalledOnce()
  })

  it('recovers when activation never changes the controller', async () => {
    vi.useFakeTimers()
    const harness = createHarness({ waiting: true })
    let launchSettled = false
    void harness.manager.waitForLaunch().then(() => {
      launchSettled = true
    })
    await register(harness)
    await vi.advanceTimersByTimeAsync(0)
    expect(harness.manager.getSnapshot()).toEqual({ status: 'restarting' })

    await vi.advanceTimersByTimeAsync(4999)
    expect(launchSettled).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    expect(launchSettled).toBe(true)
    expect(harness.manager.getSnapshot()).toEqual({ status: 'restarting' })

    await vi.advanceTimersByTimeAsync(5000)

    expect(harness.manager.getSnapshot()).toEqual({
      status: 'available',
      error: 'restart',
      forceRestartAvailable: true,
    })
    expect(harness.storage.removeItem).toHaveBeenCalledWith(
      'spliit-pwa-update-restart',
    )
  })

  it('recovers when a requested reload does not unload the document', async () => {
    vi.useFakeTimers()
    const harness = createHarness()
    await register(harness)

    harness.changeController()
    expect(harness.reload).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(10_000)

    expect(harness.manager.getSnapshot()).toEqual({
      status: 'available',
      error: 'restart',
    })
  })

  it('retries a reload directly after the new controller is already active', async () => {
    vi.useFakeTimers()
    const harness = createHarness({ waiting: true })
    await register(harness)
    await vi.advanceTimersByTimeAsync(0)

    harness.setWaiting(false)
    harness.changeController()
    expect(harness.reload).toHaveBeenCalledOnce()

    await vi.advanceTimersByTimeAsync(10_000)
    await harness.manager.restartNow()

    expect(harness.reload).toHaveBeenCalledTimes(2)
    expect(harness.manager.getSnapshot()).toEqual({ status: 'restarting' })
  })

  it('recovers when force-restart messaging throws', async () => {
    const harness = createHarness({
      waiting: true,
      activation: 'blocked',
      forceFailure: true,
    })
    await register(harness)
    await waitForSnapshot(harness, {
      status: 'available',
      otherClientsBlocked: true,
      otherClientCount: 1,
    })

    await harness.manager.forceRestartAll()

    expect(harness.manager.getSnapshot()).toEqual({
      status: 'available',
      error: 'restart',
      forceRestartAvailable: true,
    })
  })

  it('does not prompt again after deferring the update', async () => {
    vi.useFakeTimers()
    const harness = createHarness()
    await register(harness)
    await vi.advanceTimersByTimeAsync(1000)
    harness.setWaiting(true)
    harness.callbacks().onNeedRefresh?.()

    harness.manager.deferUntilNextLaunch()
    harness.callbacks().onNeedRefresh?.()

    expect(harness.manager.getSnapshot()).toEqual({ status: 'current' })
  })

  it('fails open when the launch update check rejects', async () => {
    const harness = createHarness({ updateFailure: true })
    await register(harness)

    await harness.manager.waitForLaunch()
    expect(harness.manager.getSnapshot()).toEqual({
      status: 'current',
      error: 'registration',
    })
  })

  it('fails open when the launch update check throws synchronously', async () => {
    const harness = createHarness({ updateThrows: true })
    await register(harness)

    await harness.manager.waitForLaunch()
    expect(harness.manager.getSnapshot()).toEqual({
      status: 'current',
      error: 'registration',
    })
  })

  it('subscribes the registered worker to periodic update checks', async () => {
    const harness = createHarness()
    await register(harness)

    expect(harness.subscribeUpdateChecks).toHaveBeenCalledWith(
      harness.registration,
    )
  })
})

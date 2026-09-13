import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PwaServiceWorkerContainer } from './pwa-service-worker'
import {
  createPwaUpdateManager,
  PWA_UPDATE_RESTART_KEY,
} from './pwa-update-manager'

type Activation = 'accepted' | 'blocked' | 'failed' | 'timeout' | 'manual'

function createHarness(
  options: {
    activation?: Activation
    blocked?: boolean
    ready?: boolean
    initialController?: boolean
    waiting?: boolean
    visible?: boolean
  } = {},
) {
  let activation = options.activation ?? 'accepted'
  let blocked = options.blocked ?? false
  let ready = options.ready ?? true
  let visible = options.visible ?? true
  let waiting = options.waiting ?? true
  let controller: ServiceWorker | null =
    options.initialController === false ? null : ({} as ServiceWorker)
  let pendingFinal: MessagePort | undefined
  const workerEvents = new EventTarget()
  const registrationEvents = new EventTarget()
  const blockerListeners = new Set<() => void>()
  const focusListeners = new Set<() => void>()
  const visibilityListeners = new Set<() => void>()
  const onlineListeners = new Set<() => void>()
  const assetListeners = new Set<() => void>()
  const workerReplies: unknown[] = []
  const finalMessage = (value: Record<string, unknown>) => ({
    type: 'COORDINATION_RESULT',
    protocol: 1,
    ...value,
  })
  const waitingWorker = {
    state: 'installed',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    postMessage: vi.fn(
      (message: Record<string, unknown>, transfer?: Transferable[]) => {
        if (message.type !== 'REQUEST_COORDINATED_ACTIVATION') {
          workerReplies.push(message)
          return
        }
        const port = transfer?.[0] as MessagePort | undefined
        if (activation === 'timeout') return
        if (activation === 'manual') {
          pendingFinal = port
          return
        }
        if (activation === 'blocked') {
          port?.postMessage(
            finalMessage({
              activated: false,
              reason: 'peer-blocked',
              clientCount: 2,
            }),
          )
          return
        }
        if (activation === 'failed') {
          port?.postMessage(
            finalMessage({
              activated: false,
              reason: 'activation-failed',
              clientCount: 1,
            }),
          )
          return
        }
        port?.postMessage(finalMessage({ activated: true }))
      },
    ),
  } as unknown as ServiceWorker
  const registration = {
    get waiting() {
      return waiting ? waitingWorker : null
    },
    installing: null,
    update: vi.fn().mockResolvedValue(undefined),
    addEventListener:
      registrationEvents.addEventListener.bind(registrationEvents),
    removeEventListener:
      registrationEvents.removeEventListener.bind(registrationEvents),
  } as unknown as ServiceWorkerRegistration
  const registerServiceWorker = vi.fn().mockResolvedValue(registration)
  const reload = vi.fn()
  const storage = { setItem: vi.fn(), removeItem: vi.fn() }
  const subscribeUpdateChecks = vi.fn(() => vi.fn())
  const container = {
    get controller() {
      return controller
    },
    register: vi.fn(),
    addEventListener: workerEvents.addEventListener.bind(workerEvents),
    removeEventListener: workerEvents.removeEventListener.bind(workerEvents),
  } as PwaServiceWorkerContainer
  const subscribe = (set: Set<() => void>) => (listener: () => void) => {
    set.add(listener)
    return () => set.delete(listener)
  }
  const manager = createPwaUpdateManager({
    enabled: true,
    serviceWorker: container,
    registerServiceWorker,
    reload,
    storage,
    subscribeUpdateChecks,
    hasBlockers: () => blocked,
    isProtectionReady: () => ready,
    subscribeBlockers: subscribe(blockerListeners),
    subscribeWindowFocus: subscribe(focusListeners),
    subscribeVisibility: subscribe(visibilityListeners),
    subscribeOnline: subscribe(onlineListeners),
    subscribeAssetErrors: subscribe(assetListeners),
    isVisible: () => visible,
    clientCheckTimeoutMs: 50,
    retryIntervalMs: 100,
    activationTimeoutMs: 200,
  })

  const fireWorkerMessage = (
    source: ServiceWorker,
    data: Record<string, unknown>,
  ) => {
    const event = new Event('message') as MessageEvent
    Object.assign(event, { source, data })
    workerEvents.dispatchEvent(event)
  }

  return {
    manager,
    registration,
    registerServiceWorker,
    reload,
    storage,
    subscribeUpdateChecks,
    waitingWorker,
    workerReplies,
    settleRegistration: async () => {
      await vi.waitFor(() =>
        expect(registerServiceWorker).toHaveBeenCalledOnce(),
      )
      await Promise.resolve()
    },
    setBlocked(value: boolean) {
      blocked = value
      blockerListeners.forEach((listener) => listener())
    },
    setReady(value: boolean) {
      ready = value
      blockerListeners.forEach((listener) => listener())
    },
    setActivation(value: Activation) {
      activation = value
    },
    setWaiting(value: boolean) {
      waiting = value
    },
    setVisible(value: boolean) {
      visible = value
    },
    focus: () => focusListeners.forEach((listener) => listener()),
    assetError: () => assetListeners.forEach((listener) => listener()),
    changeController(next: ServiceWorker = waitingWorker) {
      controller = next
      workerEvents.dispatchEvent(new Event('controllerchange'))
    },
    prepare(source: ServiceWorker = waitingWorker) {
      fireWorkerMessage(source, {
        type: 'COORDINATION_PREPARE',
        protocol: 1,
        attemptId: 'attempt-1',
        workerToken: 'worker-1',
      })
    },
    confirm(source: ServiceWorker = waitingWorker) {
      fireWorkerMessage(source, {
        type: 'COORDINATION_CONFIRM',
        protocol: 1,
        attemptId: 'attempt-1',
        workerToken: 'worker-1',
      })
    },
    abort(source: ServiceWorker = waitingWorker) {
      fireWorkerMessage(source, {
        type: 'COORDINATION_ABORTED',
        protocol: 1,
        attemptId: 'attempt-1',
      })
    },
    deliverFinal(value: Record<string, unknown>) {
      pendingFinal?.postMessage(finalMessage(value))
    },
  }
}

describe('createPwaUpdateManager', () => {
  afterEach(() => vi.useRealTimers())

  it('does nothing outside production when not explicitly enabled', async () => {
    const registerServiceWorker = vi.fn()
    const manager = createPwaUpdateManager({
      enabled: false,
      serviceWorker: {} as PwaServiceWorkerContainer,
      registerServiceWorker,
    })
    await Promise.resolve()
    expect(registerServiceWorker).not.toHaveBeenCalled()
    expect(manager.getSnapshot()).toEqual({ status: 'hidden' })
  })

  it('registers natively, checks immediately, and subscribes for later checks', async () => {
    const harness = createHarness({ waiting: false })
    await harness.settleRegistration()
    expect(harness.registration.update).toHaveBeenCalledOnce()
    expect(harness.subscribeUpdateChecks).toHaveBeenCalledWith(
      harness.registration,
    )
  })

  it('coordinates an existing update and reloads after controller takeover', async () => {
    const harness = createHarness()
    await harness.settleRegistration()
    await vi.waitFor(() =>
      expect(harness.waitingWorker.postMessage).toHaveBeenCalledWith(
        { type: 'REQUEST_COORDINATED_ACTIVATION', protocol: 1 },
        expect.any(Array),
      ),
    )
    harness.changeController()
    expect(harness.reload).toHaveBeenCalledOnce()
    expect(harness.storage.setItem).toHaveBeenCalledWith(
      PWA_UPDATE_RESTART_KEY,
      '1',
    )
  })

  it('waits silently for local work and resumes when it finishes', async () => {
    vi.useFakeTimers()
    const harness = createHarness({ blocked: true })
    await harness.settleRegistration()
    expect(harness.waitingWorker.postMessage).not.toHaveBeenCalled()
    expect(harness.manager.getSnapshot()).toEqual({ status: 'hidden' })

    harness.setBlocked(false)
    await vi.advanceTimersByTimeAsync(0)
    expect(harness.waitingWorker.postMessage).toHaveBeenCalledOnce()
    harness.changeController()
    expect(harness.reload).toHaveBeenCalledOnce()
  })

  it('resumes a controller replacement after blockers clear', async () => {
    vi.useFakeTimers()
    const harness = createHarness({ blocked: true, waiting: false })
    await harness.settleRegistration()
    harness.changeController({} as ServiceWorker)
    expect(harness.reload).not.toHaveBeenCalled()

    harness.setBlocked(false)
    await vi.advanceTimersByTimeAsync(0)
    expect(harness.reload).toHaveBeenCalledOnce()
  })

  it('retries an unverifiable peer on focus without showing UI', async () => {
    const harness = createHarness({ activation: 'blocked' })
    await harness.settleRegistration()
    await vi.waitFor(() =>
      expect(harness.waitingWorker.postMessage).toHaveBeenCalledOnce(),
    )
    expect(harness.manager.getSnapshot()).toEqual({ status: 'hidden' })

    harness.setActivation('accepted')
    harness.focus()
    await vi.waitFor(() =>
      expect(harness.waitingWorker.postMessage).toHaveBeenCalledTimes(2),
    )
  })

  it('only reports activation failures and supports dismissal and retry', async () => {
    const harness = createHarness({ activation: 'failed' })
    await harness.settleRegistration()
    await vi.waitFor(() =>
      expect(harness.manager.getSnapshot()).toEqual({
        status: 'failed',
        dismissed: false,
      }),
    )
    harness.manager.dismissFailure()
    expect(harness.manager.getSnapshot()).toEqual({
      status: 'failed',
      dismissed: true,
    })

    harness.setActivation('accepted')
    harness.manager.retry()
    await vi.waitFor(() =>
      expect(harness.waitingWorker.postMessage).toHaveBeenCalledTimes(2),
    )
    expect(harness.manager.getSnapshot()).toEqual({ status: 'hidden' })
  })

  it('fails when activation never changes the controller', async () => {
    vi.useFakeTimers()
    const harness = createHarness()
    await harness.settleRegistration()
    await vi.advanceTimersByTimeAsync(250)
    expect(harness.manager.getSnapshot()).toEqual({
      status: 'failed',
      dismissed: false,
    })
  })

  it('guards runtime asset-error reloads until local work finishes', async () => {
    vi.useFakeTimers()
    const harness = createHarness({ waiting: false, blocked: true })
    await harness.settleRegistration()
    harness.assetError()
    expect(harness.reload).not.toHaveBeenCalled()

    harness.setBlocked(false)
    await vi.advanceTimersByTimeAsync(0)
    expect(harness.reload).toHaveBeenCalledOnce()
  })

  it('answers coordination rounds from the expected waiting worker only', async () => {
    const harness = createHarness({ blocked: true })
    await harness.settleRegistration()
    harness.prepare()
    expect(harness.workerReplies).toContainEqual({
      type: 'COORDINATION_PREPARE_RESPONSE',
      protocol: 1,
      attemptId: 'attempt-1',
      status: 'blocked',
    })

    const foreign = {
      postMessage: vi.fn(),
    } as unknown as ServiceWorker
    harness.prepare(foreign)
    expect(foreign.postMessage).not.toHaveBeenCalled()
  })

  it('binds final authorization to the worker that takes control', async () => {
    vi.useFakeTimers()
    const harness = createHarness({ activation: 'manual' })
    await harness.settleRegistration()
    harness.confirm()
    harness.setBlocked(true)

    const foreign = {} as ServiceWorker
    harness.changeController(foreign)
    expect(harness.reload).not.toHaveBeenCalled()
    harness.setBlocked(false)
    await vi.advanceTimersByTimeAsync(0)
    expect(harness.reload).toHaveBeenCalledOnce()
  })

  it('honors matching final authorization despite handoff-window input', async () => {
    const harness = createHarness({ activation: 'manual' })
    await harness.settleRegistration()
    harness.confirm()
    harness.setBlocked(true)
    harness.changeController()
    expect(harness.reload).toHaveBeenCalledOnce()
  })

  it('handles controller takeover before the final result without duplicate reloads', async () => {
    const harness = createHarness({ activation: 'manual' })
    await harness.settleRegistration()
    harness.confirm()
    harness.changeController()
    harness.deliverFinal({ activated: true })
    await Promise.resolve()
    expect(harness.reload).toHaveBeenCalledOnce()
  })

  it('drops final authorization after a matching abort', async () => {
    vi.useFakeTimers()
    const harness = createHarness({ activation: 'manual' })
    await harness.settleRegistration()
    harness.confirm()
    harness.abort()
    harness.setBlocked(true)
    harness.changeController()
    expect(harness.reload).not.toHaveBeenCalled()
  })

  it('treats missing coordination replies as a silent wait', async () => {
    vi.useFakeTimers()
    const harness = createHarness({ activation: 'timeout' })
    await harness.settleRegistration()
    await vi.advanceTimersByTimeAsync(60)
    expect(harness.manager.getSnapshot()).toEqual({ status: 'hidden' })
    expect(harness.reload).not.toHaveBeenCalled()
  })

  it('does not reload when the first controller claims the page', async () => {
    const harness = createHarness({ initialController: false, waiting: false })
    await harness.settleRegistration()
    harness.changeController({} as ServiceWorker)
    expect(harness.reload).not.toHaveBeenCalled()
  })

  it('disposes browser subscriptions and ignores later signals', async () => {
    const harness = createHarness({ blocked: true })
    await harness.settleRegistration()
    harness.manager.dispose()
    harness.setBlocked(false)
    harness.focus()
    expect(harness.waitingWorker.postMessage).not.toHaveBeenCalled()
  })
})

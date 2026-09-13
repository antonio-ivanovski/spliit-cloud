import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  coordinatorBeginAttempt,
  coordinatorEndAttempt,
  resetCoordinatorForTests,
  runCoordinatedActivation,
  type CoordinatorClient,
  type CoordinatorHooks,
  type CoordinatorInboundEvent,
} from './pwa-update-coordinator'
import { PWA_UPDATE_PROTOCOL_VERSION } from './pwa-update-protocol'

type Message = Record<string, unknown>

function cleanReport(message: Message) {
  return {
    protocol: PWA_UPDATE_PROTOCOL_VERSION,
    attemptId: message.attemptId,
    status: message.type === 'COORDINATION_PREPARE' ? 'clean' : 'confirmed',
  }
}

type FakeClient = CoordinatorClient & {
  received: unknown[]
  onMessage: (message: Message) => void
}

function makeClient(
  id: string,
  answer: (message: Message, reply: (data: unknown) => void) => void,
): FakeClient {
  const client: FakeClient = {
    id,
    received: [],
    onMessage: (message) => {
      answer(message, (data) => {
        dispatchToWorker({ sourceId: id, data })
      })
    },
    postMessage: (message: unknown) => {
      client.received.push(message)
      // Delivery is asynchronous like a real client message.
      void Promise.resolve().then(() => {
        client.onMessage(message as Message)
      })
    },
  }
  return client
}

// The worker-side subscription installed by the current round.
let dispatchToWorker: (event: CoordinatorInboundEvent) => void = () => {}

function makeHooks(options: {
  enumerations: FakeClient[][]
  skipWaiting?: () => Promise<unknown>
}): { hooks: CoordinatorHooks; skipWaiting: ReturnType<typeof vi.fn> } {
  const queue = [...options.enumerations]
  const matchAllWindows = vi.fn(() =>
    Promise.resolve(queue.length > 1 ? queue.shift()! : (queue[0] ?? [])),
  )
  const subscribeMessages = vi.fn(
    (handler: (event: CoordinatorInboundEvent) => void) => {
      dispatchToWorker = handler
      return () => {
        if (dispatchToWorker === handler) dispatchToWorker = () => {}
      }
    },
  )
  const skipWaiting = vi.fn(
    options.skipWaiting ?? (() => Promise.resolve(undefined)),
  )
  const hooks: CoordinatorHooks = {
    matchAllWindows: () => matchAllWindows() as Promise<CoordinatorClient[]>,
    skipWaiting,
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (handle: unknown) =>
      clearTimeout(handle as ReturnType<typeof setTimeout>),
    subscribeMessages,
  }
  return { hooks, skipWaiting }
}

function cleanClient(id: string): FakeClient {
  return makeClient(id, (message, answer) => {
    answer(cleanReport(message))
  })
}

function run(
  hooks: CoordinatorHooks,
  clients: FakeClient[],
  extra?: { requesterId?: string; timeoutMs?: number },
) {
  return runCoordinatedActivation(hooks, {
    attemptId: 'attempt-1',
    workerToken: 'worker-1',
    requesterId: extra?.requesterId ?? clients[0]?.id,
    timeoutMs: extra?.timeoutMs,
  })
}

function messageTypes(client: FakeClient): unknown[] {
  return client.received.map((message) => (message as Message).type)
}

describe('runCoordinatedActivation', () => {
  afterEach(() => {
    vi.useRealTimers()
    resetCoordinatorForTests()
    dispatchToWorker = () => {}
  })

  it('activates when a single client prepares and confirms clean', async () => {
    const client = cleanClient('a')
    const { hooks, skipWaiting } = makeHooks({ enumerations: [[client]] })

    const result = await run(hooks, [client])

    expect(result).toEqual({ activated: true })
    expect(skipWaiting).toHaveBeenCalledOnce()
    expect(messageTypes(client)).toEqual([
      'COORDINATION_PREPARE',
      'COORDINATION_CONFIRM',
    ])
  })

  it('activates when every window client confirms clean', async () => {
    const clients = [cleanClient('a'), cleanClient('b'), cleanClient('c')]
    const { hooks } = makeHooks({ enumerations: [clients] })

    const result = await run(hooks, clients)

    expect(result).toEqual({ activated: true })
    clients.forEach((client) => {
      expect(messageTypes(client)).toEqual([
        'COORDINATION_PREPARE',
        'COORDINATION_CONFIRM',
      ])
    })
  })

  it('aborts when a peer reports unfinished work in prepare', async () => {
    const clients = [
      cleanClient('a'),
      makeClient('b', (message, answer) => {
        answer({
          protocol: PWA_UPDATE_PROTOCOL_VERSION,
          attemptId: message.attemptId,
          status: 'blocked',
        })
      }),
    ]
    const { hooks, skipWaiting } = makeHooks({ enumerations: [clients] })

    const result = await run(hooks, clients)

    expect(result).toEqual({
      activated: false,
      reason: 'peer-blocked',
      clientCount: 2,
    })
    expect(skipWaiting).not.toHaveBeenCalled()
    expect(messageTypes(clients[1])).toEqual([
      'COORDINATION_PREPARE',
      'COORDINATION_ABORTED',
    ])
  })

  it('aborts when a peer is not ready in prepare', async () => {
    const clients = [
      makeClient('a', (message, answer) => {
        answer({
          protocol: PWA_UPDATE_PROTOCOL_VERSION,
          attemptId: message.attemptId,
          status: 'not-ready',
        })
      }),
    ]
    const { hooks, skipWaiting } = makeHooks({ enumerations: [clients] })

    const result = await run(hooks, clients)

    expect(result).toEqual({
      activated: false,
      reason: 'peer-blocked',
      clientCount: 1,
    })
    expect(skipWaiting).not.toHaveBeenCalled()
  })

  it('aborts when a peer never answers (legacy or sleeping page)', async () => {
    vi.useFakeTimers()
    const clients = [cleanClient('a'), makeClient('b', () => {})]
    const { hooks, skipWaiting } = makeHooks({ enumerations: [clients] })

    const pending = run(hooks, clients, { timeoutMs: 50 })
    await vi.advanceTimersByTimeAsync(200)

    expect(await pending).toEqual({
      activated: false,
      reason: 'peer-missing',
      clientCount: 2,
    })
    expect(skipWaiting).not.toHaveBeenCalled()
  })

  it('ignores garbage and stale-attempt responses', async () => {
    vi.useFakeTimers()
    const clients = [
      makeClient('a', (message, answer) => {
        answer({
          // Right shape, wrong attempt: must not count as clean.
          protocol: PWA_UPDATE_PROTOCOL_VERSION,
          attemptId: 'stale-attempt',
          status:
            message.type === 'COORDINATION_PREPARE' ? 'clean' : 'confirmed',
        })
      }),
    ]
    const { hooks } = makeHooks({ enumerations: [clients] })

    const pending = run(hooks, clients, { timeoutMs: 50 })
    await vi.advanceTimersByTimeAsync(200)

    expect(await pending).toEqual({
      activated: false,
      reason: 'peer-missing',
      clientCount: 1,
    })
  })

  it('aborts without activating when a peer rejects at confirm time', async () => {
    const confirmer = cleanClient('a')
    const rejecter = makeClient('b', (message, answer) => {
      answer({
        protocol: PWA_UPDATE_PROTOCOL_VERSION,
        attemptId: message.attemptId,
        status: message.type === 'COORDINATION_PREPARE' ? 'clean' : 'rejected',
      })
    })
    const clients = [confirmer, rejecter]
    const { hooks, skipWaiting } = makeHooks({ enumerations: [clients] })

    const result = await run(hooks, clients)

    expect(result).toEqual({
      activated: false,
      reason: 'peer-blocked',
      clientCount: 2,
    })
    expect(skipWaiting).not.toHaveBeenCalled()
    // Cancellation reaches every contacted client; only confirmed clients
    // will have an authorization to clear.
    expect(messageTypes(confirmer)).toEqual([
      'COORDINATION_PREPARE',
      'COORDINATION_CONFIRM',
      'COORDINATION_ABORTED',
    ])
    expect(messageTypes(rejecter)).toEqual([
      'COORDINATION_PREPARE',
      'COORDINATION_CONFIRM',
      'COORDINATION_ABORTED',
    ])
  })

  it('aborts when a confirm response never arrives', async () => {
    vi.useFakeTimers()
    const confirmer = cleanClient('a')
    const silent = makeClient('b', (message, answer) => {
      if (message.type === 'COORDINATION_PREPARE') {
        answer({
          protocol: PWA_UPDATE_PROTOCOL_VERSION,
          attemptId: message.attemptId,
          status: 'clean',
        })
      }
    })
    const clients = [confirmer, silent]
    const { hooks, skipWaiting } = makeHooks({ enumerations: [clients] })

    const pending = run(hooks, clients, { timeoutMs: 50 })
    await vi.advanceTimersByTimeAsync(300)

    expect(await pending).toEqual({
      activated: false,
      reason: 'peer-missing',
      clientCount: 2,
    })
    expect(skipWaiting).not.toHaveBeenCalled()
    expect(messageTypes(confirmer)).toContain('COORDINATION_ABORTED')
  })

  it('aborts when a new client appears before activation', async () => {
    const clients = [cleanClient('a')]
    const newcomer = cleanClient('new')
    const { hooks, skipWaiting } = makeHooks({
      // Prepare sees [a]; re-enumeration sees [a, new].
      enumerations: [clients, [...clients, newcomer]],
    })

    const result = await run(hooks, clients)

    expect(result).toEqual({
      activated: false,
      reason: 'new-client',
      clientCount: 2,
    })
    expect(skipWaiting).not.toHaveBeenCalled()
    expect(messageTypes(clients[0])).toContain('COORDINATION_ABORTED')
  })

  it('drops closed clients and activates for the remainder', async () => {
    const clients = [cleanClient('a'), cleanClient('b')]
    const { hooks, skipWaiting } = makeHooks({
      // Both rounds see [a, b]; then b closes before activation.
      enumerations: [clients, [clients[0]]],
    })

    const result = await run(hooks, clients)

    expect(result).toEqual({ activated: true })
    expect(skipWaiting).toHaveBeenCalledOnce()
  })

  it('aborts when the requester is gone at prepare time', async () => {
    const client = cleanClient('a')
    const { hooks, skipWaiting } = makeHooks({ enumerations: [[client]] })

    const result = await run(hooks, [client], { requesterId: 'gone' })

    expect(result).toEqual({
      activated: false,
      reason: 'requester-gone',
      clientCount: 1,
    })
    expect(skipWaiting).not.toHaveBeenCalled()
    expect(client.received).toEqual([])
  })

  it('aborts when the requester closes before activation', async () => {
    const clients = [cleanClient('requester'), cleanClient('b')]
    const { hooks, skipWaiting } = makeHooks({
      enumerations: [clients, [clients[1]]],
    })

    const result = await run(hooks, clients, { requesterId: 'requester' })

    expect(result).toEqual({
      activated: false,
      reason: 'requester-gone',
      clientCount: 1,
    })
    expect(skipWaiting).not.toHaveBeenCalled()
    expect(messageTypes(clients[1])).toContain('COORDINATION_ABORTED')
  })

  it('activates directly when no window clients remain', async () => {
    const { hooks, skipWaiting } = makeHooks({ enumerations: [[]] })

    const result = await runCoordinatedActivation(hooks, {
      attemptId: 'attempt-1',
      workerToken: 'worker-1',
    })

    expect(result).toEqual({ activated: true })
    expect(skipWaiting).toHaveBeenCalledOnce()
  })

  it('reports activation failure when skipWaiting throws', async () => {
    const client = cleanClient('a')
    const { hooks, skipWaiting } = makeHooks({
      enumerations: [[client]],
      skipWaiting: () => Promise.reject(new Error('quiesce failed')),
    })

    const result = await run(hooks, [client])

    expect(result).toEqual({
      activated: false,
      reason: 'activation-failed',
      clientCount: 1,
    })
    expect(skipWaiting).toHaveBeenCalledOnce()
    expect(messageTypes(client)).toContain('COORDINATION_ABORTED')
  })

  it('aborts quietly when client enumeration fails', async () => {
    const { hooks, skipWaiting } = makeHooks({ enumerations: [[]] })
    hooks.matchAllWindows = () =>
      Promise.reject(new Error('clients unavailable'))

    const result = await runCoordinatedActivation(hooks, {
      attemptId: 'attempt-1',
      workerToken: 'worker-1',
    })

    expect(result).toEqual({
      activated: false,
      reason: 'activation-failed',
      clientCount: 0,
    })
    expect(skipWaiting).not.toHaveBeenCalled()
  })

  it('lets the latest report supersede an earlier one', async () => {
    // Clean first, then blocked (e.g. the user started editing mid-round):
    // the newer report governs and the attempt aborts.
    const client = makeClient('a', (message, answer) => {
      answer(cleanReport(message))
      answer({
        protocol: PWA_UPDATE_PROTOCOL_VERSION,
        attemptId: message.attemptId,
        status:
          message.type === 'COORDINATION_PREPARE' ? 'blocked' : 'rejected',
      })
    })
    const { hooks, skipWaiting } = makeHooks({ enumerations: [[client]] })

    expect(await run(hooks, [client])).toEqual({
      activated: false,
      reason: 'peer-blocked',
      clientCount: 1,
    })
    expect(skipWaiting).not.toHaveBeenCalled()
  })

  it('serializes attempts with the single-attempt lock', () => {
    expect(coordinatorBeginAttempt('one')).toBe(true)
    expect(coordinatorBeginAttempt('two')).toBe(false)
    coordinatorEndAttempt('two')
    expect(coordinatorBeginAttempt('three')).toBe(false)
    coordinatorEndAttempt('one')
    expect(coordinatorBeginAttempt('three')).toBe(true)
    coordinatorEndAttempt('three')
  })
})

import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { CapabilityError, PermissionError } from './errors'
import { makePushService, type PushServiceDeps } from './push'

// Authoring gate (test-audit): this file owns the push lifecycle —
// capability/permission gating before any browser API, no worker hang on
// worker-less hosts, best-effort server outcomes, and sign-out cleanup that
// never fails logout. Regression: awaiting serviceWorker.ready on a
// worker-less host would hang sign-out forever; a denied permission
// re-prompted on every visit would nag; a failed server row write treated
// as fatal would block the toggle UI. VAPID/crypto behavior stays owned by
// the push boundary tests; this file owns the Effect service around the
// injected browser/server seams.

function record(endpoint: string) {
  return {
    endpoint,
    keys: { p256dh: 'p256dh', auth: 'auth' },
    unsubscribe: () => Promise.resolve(),
  }
}

function harness(overrides?: Partial<PushServiceDeps>) {
  const calls: string[] = []
  const service = makePushService({
    isSupported: () => true,
    getPermission: () => 'granted' as const,
    getRegistration: () => Promise.resolve({ id: 'reg' }),
    getSubscription: () => Promise.resolve(null),
    subscribe: () => {
      calls.push('subscribe')
      return Promise.resolve(record('https://push.example/e1'))
    },
    registerOnServer: () => {
      calls.push('register')
      return Promise.resolve()
    },
    removeFromServer: () => {
      calls.push('remove')
      return Promise.resolve()
    },
    ...overrides,
  })
  return { service, calls }
}

async function enableError(service: ReturnType<typeof makePushService>) {
  return Effect.runPromise(
    service.enable('vapid-key').pipe(
      Effect.matchEffect({
        onFailure: (error) => Effect.succeed(error),
        onSuccess: () => Effect.succeed(null),
      }),
    ),
  )
}

describe('push capability and permission', () => {
  it('fails capability before touching browser APIs when unsupported', async () => {
    let touched = false
    const { service } = harness({
      isSupported: () => false,
      getRegistration: () => {
        touched = true
        return Promise.resolve(null)
      },
    })
    const error = await enableError(service)
    expect(error).toBeInstanceOf(CapabilityError)
    expect(touched).toBe(false)
  })

  it('fails permission without re-prompting when denied', async () => {
    let prompted = false
    const { service } = harness({
      getPermission: () => 'denied' as const,
      requestPermission: () => {
        prompted = true
        return Promise.resolve('granted' as const)
      },
    })
    const error = await enableError(service)
    expect(error).toBeInstanceOf(PermissionError)
    expect(prompted).toBe(false)
  })

  it('fails capability when no worker registration exists instead of hanging', async () => {
    const { service } = harness({
      getRegistration: () => Promise.resolve(null),
    })
    const error = await enableError(service)
    expect(error).toBeInstanceOf(CapabilityError)
  })
})

describe('push subscription lifecycle', () => {
  it('subscribes and registers on granted permission', async () => {
    const { service, calls } = harness()
    const outcome = await Effect.runPromise(service.enable('vapid-key'))
    expect(outcome).toEqual({ enabled: true })
    expect(calls).toEqual(['subscribe', 'register'])
    const snapshot = await Effect.runPromise(service.snapshot)
    expect(snapshot.endpoint).toBe('https://push.example/e1')
    expect(snapshot.serverRegistered).toBe(true)
  })

  it('reports server failure as an outcome, not a fatal error', async () => {
    const { service, calls } = harness({
      registerOnServer: () => Promise.reject(new Error('row write down')),
    })
    const outcome = await Effect.runPromise(service.enable('vapid-key'))
    expect(outcome).toEqual({ enabled: false, reason: 'server-error' })
    expect(calls).toEqual(['subscribe'])
    const snapshot = await Effect.runPromise(service.snapshot)
    expect(snapshot.endpoint).toBe('https://push.example/e1')
    expect(snapshot.serverRegistered).toBe(false)
  })

  it('disables with best-effort server removal', async () => {
    const { service, calls } = harness({
      getSubscription: () => Promise.resolve(record('https://push.example/e1')),
    })
    await Effect.runPromise(service.refresh)
    await Effect.runPromise(service.disable)
    expect(calls).toContain('remove')
    const snapshot = await Effect.runPromise(service.snapshot)
    expect(snapshot.endpoint).toBe(null)
    expect(snapshot.serverRegistered).toBe(false)
  })
})

describe('sign-out cleanup', () => {
  it('removes the server row and unsubscribes, returning true', async () => {
    let unsubscribed = false
    const { service } = harness({
      getSubscription: () =>
        Promise.resolve({
          ...record('https://push.example/e9'),
          unsubscribe: () => {
            unsubscribed = true
            return Promise.resolve()
          },
        }),
    })
    const cleaned = await Effect.runPromise(service.disconnectForSignOut)
    expect(cleaned).toBe(true)
    expect(unsubscribed).toBe(true)
  })

  it('returns false when nothing is subscribed and never fails logout', async () => {
    const { service } = harness({
      getSubscription: () => Promise.resolve(null),
    })
    expect(await Effect.runPromise(service.disconnectForSignOut)).toBe(false)
  })

  it('still completes logout when the server removal throws', async () => {
    const { service } = harness({
      getSubscription: () => Promise.resolve(record('https://push.example/e1')),
      removeFromServer: () => Promise.reject(new Error('api down')),
    })
    expect(await Effect.runPromise(service.disconnectForSignOut)).toBe(true)
  })
})

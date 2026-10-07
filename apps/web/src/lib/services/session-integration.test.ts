import { describe, expect, it } from 'vitest'

import {
  makeBetterAuthFetchSession,
  revokeIdentitySync,
  toSessionProbeResult,
} from './session-integration'

// Authoring gate (test-audit): this file owns the SDK-boundary mapping — one
// better-auth result becomes exactly one probe result with the
// revoke-vs-preserve semantics. Regression: a failed check mapped to
// signed-out would sign users out on a network blip; an abort normalized
// to a verdict would let a late callback revoke the wrong identity. The
// session-verify composition is owned by session.test.ts; this file owns
// only the boundary normalization plus the sync marker write. The stub
// getSession is the production GetSessionFn parameter, not a test seam.

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => {
      map.delete(key)
    },
    setItem: (key: string, value: string) => {
      map.set(key, value)
    },
  }
}

describe('session probe mapping', () => {
  it('verifies a present user with its account', () => {
    const user = { id: 'account-1' }
    expect(toSessionProbeResult({ user }, null)).toEqual({ account: user })
  })

  it('revokes only on a successful null session', () => {
    expect(toSessionProbeResult(null, null)).toEqual({ account: null })
  })

  it('preserves identity on network failure with the flag set', () => {
    const result = toSessionProbeResult(null, new TypeError('Failed to fetch'))
    expect(result).toEqual({
      failed: true,
      network: true,
      status: undefined,
    })
  })

  it('preserves identity on server errors with the status attached', () => {
    const failure = Object.assign(new Error('server exploded'), { status: 503 })
    expect(toSessionProbeResult(null, failure)).toEqual({
      failed: true,
      network: false,
      status: 503,
    })
  })
})

describe('better-auth fetch boundary', () => {
  it('passes verified sessions through with the account', async () => {
    const user = { id: 'account-1' }
    const fetchSession = makeBetterAuthFetchSession(() =>
      Promise.resolve({ data: { user }, error: null }),
    )
    const controller = new AbortController()
    expect(await fetchSession(controller.signal)).toEqual({ account: user })
  })

  it('throws aborts instead of normalizing them to verdicts', async () => {
    const fetchSession = makeBetterAuthFetchSession(() =>
      Promise.resolve({ data: null, error: null }),
    )
    await expect(fetchSession(AbortSignal.abort())).rejects.toMatchObject({
      name: 'AbortError',
    })
  })

  it('maps SDK throws to preserved failure results', async () => {
    const fetchSession = makeBetterAuthFetchSession(() =>
      Promise.reject(new TypeError('Failed to fetch')),
    )
    const controller = new AbortController()
    const result = await fetchSession(controller.signal)
    expect(result).toMatchObject({ failed: true, network: true })
  })
})

describe('synchronous revocation', () => {
  it('writes the marker synchronously and reports success', () => {
    const storage = memoryStorage()
    const namespace = 'namespace-revoke-1'
    expect(revokeIdentitySync(namespace, storage)).toBe(true)
    const keys: string[] = []
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index)
      if (key) keys.push(key)
    }
    expect(
      keys.some((key) => key.includes(encodeURIComponent(namespace))),
    ).toBe(true)
  })

  it('reports false when the marker cannot be written', () => {
    const working = memoryStorage()
    const broken: Storage = {
      get length() {
        return working.length
      },
      clear: () => working.clear(),
      getItem: (key: string) => working.getItem(key),
      key: (index: number) => working.key(index),
      removeItem: (key: string) => working.removeItem(key),
      setItem: () => {
        throw new Error('denied')
      },
    }
    expect(revokeIdentitySync('namespace-revoke-2', broken)).toBe(false)
  })
})

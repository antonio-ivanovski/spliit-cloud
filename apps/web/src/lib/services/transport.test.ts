import { Cause, Effect, Exit } from 'effect'
import { describe, expect, it } from 'vitest'

import { HttpError, NetworkError, RateLimitError, TimeoutError } from './errors'
import { classifyFetchRejection, makeFetchTransport } from './platform'

// Authoring gate (test-audit): this file owns the fetch-boundary
// normalization contract — every third-party rejection becomes exactly one
// tagged error, and caller aborts become interruption (never offline).
// Regression: an abort misclassified as NetworkError would paint offline UI
// on user navigation; a missing/invalid Retry-After default would retry early.
// Existing predicate tests (isTransportFailure etc.) cannot catch an Effect
// composition failure here, so this layer needs its own boundary proof. No
// production seams: the fetch function is injected through the production
// FetchTransportDeps options.

function stubFetch(
  handler: (input: string, init?: RequestInit) => Promise<Response>,
): typeof fetch {
  return (input, init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url
    return handler(url, init)
  }
}

function statusResponse(status: number, headers?: Record<string, string>) {
  return new Response('{}', { status, headers })
}

const transportWith = (
  handler: (input: string, init?: RequestInit) => Promise<Response>,
) => makeFetchTransport({ fetchFn: stubFetch(handler), defaultTimeoutMs: 1000 })

describe('fetch transport error normalization', () => {
  it('returns the response for successful and client-error statuses', async () => {
    const transport = transportWith(async () => statusResponse(200))
    const response = await Effect.runPromise(
      transport.request('https://api.example/health'),
    )
    expect(response.status).toBe(200)

    const notFound = transportWith(async () => statusResponse(404))
    const missing = await Effect.runPromise(
      notFound.request('https://api.example/health'),
    )
    // 4xx is a normal server answer, not a transport failure.
    expect(missing.status).toBe(404)
  })

  it('maps HTTP 5xx to HttpError with the status', async () => {
    const transport = transportWith(async () => statusResponse(503))
    const error = await Effect.runPromise(
      Effect.flip(transport.request('https://api.example/health')),
    )
    expect(error).toBeInstanceOf(HttpError)
    expect(error).toMatchObject({ status: 503 })
  })

  it('maps 429 to RateLimitError honoring Retry-After seconds', async () => {
    const transport = transportWith(async () =>
      statusResponse(429, { 'Retry-After': '2' }),
    )
    const error = await Effect.runPromise(
      Effect.flip(transport.request('https://api.example/health')),
    )
    expect(error).toBeInstanceOf(RateLimitError)
    expect(error).toMatchObject({ retryAfterMs: 2000 })
  })

  it('maps 429 with missing or invalid Retry-After to the 60s default', async () => {
    for (const headers of [undefined, { 'Retry-After': 'not-a-delay' }]) {
      const transport = transportWith(async () => statusResponse(429, headers))
      const error = await Effect.runPromise(
        Effect.flip(transport.request('https://api.example/health')),
      )
      expect(error).toBeInstanceOf(RateLimitError)
      expect(error).toMatchObject({ retryAfterMs: 60_000 })
    }
  })

  it('maps TypeError rejections to NetworkError', async () => {
    const transport = transportWith(async () => {
      throw new TypeError('Failed to fetch')
    })
    const error = await Effect.runPromise(
      Effect.flip(transport.request('https://api.example/health')),
    )
    expect(error).toBeInstanceOf(NetworkError)
  })

  it('maps unknown rejection shapes to NetworkError exactly once', async () => {
    const transport = transportWith(async () => {
      throw { code: 'ECONNRESET', detail: 'secret-payload' }
    })
    const error = await Effect.runPromise(
      Effect.flip(transport.request('https://api.example/health')),
    )
    expect(error).toBeInstanceOf(NetworkError)
    expect(error).toMatchObject({ reason: 'unknown-fetch-failure' })
  })

  it('maps an expired bound to TimeoutError', async () => {
    const transport = makeFetchTransport({
      fetchFn: stubFetch(() => new Promise<Response>(() => {})),
      defaultTimeoutMs: 15,
    })
    const error = await Effect.runPromise(
      Effect.flip(transport.request('https://api.example/health')),
    )
    expect(error).toBeInstanceOf(TimeoutError)
    expect(error).toMatchObject({ operation: 'fetch' })
  })

  it('treats a caller abort as interruption, never an offline error', async () => {
    const transport = transportWith(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'))
          })
        }),
    )
    const controller = new AbortController()
    const pending = Effect.runPromiseExit(
      transport.request('https://api.example/health', undefined, {
        signal: controller.signal,
      }),
    )
    setTimeout(() => controller.abort(), 5)
    const exit = await pending
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(Cause.hasInterrupts(exit.cause)).toBe(true)
    }
  })

  it('does not call fetch when the signal is already aborted', async () => {
    let calls = 0
    const transport = transportWith(async () => {
      calls += 1
      return statusResponse(200)
    })
    const exit = await Effect.runPromiseExit(
      transport.request('https://api.example/health', undefined, {
        signal: AbortSignal.abort(),
      }),
    )
    expect(calls).toBe(0)
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(Cause.hasInterrupts(exit.cause)).toBe(true)
    }
  })
})

describe('classifyFetchRejection', () => {
  it('prefers the timeout outcome over late answers', () => {
    const error = classifyFetchRejection(new TypeError('Failed to fetch'), {
      timedOut: true,
      aborted: false,
    })
    expect(error).toBeInstanceOf(TimeoutError)
  })

  it('returns null for aborts so callers propagate interruption', () => {
    expect(
      classifyFetchRejection(new TypeError('Failed to fetch'), {
        timedOut: false,
        aborted: true,
      }),
    ).toBeNull()
    expect(
      classifyFetchRejection(new DOMException('Aborted', 'AbortError'), {
        timedOut: false,
        aborted: false,
      }),
    ).toBeNull()
  })
})

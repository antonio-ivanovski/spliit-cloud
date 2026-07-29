import { describe, expect, it } from 'vitest'

import { createReadinessChecker } from './readiness'

const API = 'https://api.spliit.example'

type Route = { status: number; body: unknown }

function fakeFetch(routes: Record<string, Route | 'throw'>) {
  const calls: string[] = []
  const impl = (async (input: RequestInfo | URL) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url
    calls.push(url)
    const route = routes[url]
    if (!route || route === 'throw') throw new Error('network error')
    return new Response(JSON.stringify(route.body), { status: route.status })
  }) as typeof fetch
  return { impl, calls }
}

function healthyRoutes(): Record<string, Route> {
  return {
    [`${API}/health/readiness`]: { status: 200, body: { status: 'healthy' } },
    [`${API}/.well-known/oauth-authorization-server`]: {
      status: 200,
      body: {
        issuer: `${API}/auth`,
        authorization_endpoint: `${API}/auth/oauth2/authorize`,
      },
    },
    [`${API}/auth/jwks`]: { status: 200, body: { keys: [{ kid: 'k1' }] } },
  }
}

describe('createReadinessChecker', () => {
  it('reports ready when api, discovery, and jwks are healthy', async () => {
    const { impl } = fakeFetch(healthyRoutes())
    const checker = createReadinessChecker({ apiUrl: API, fetchImpl: impl })

    await expect(checker.check()).resolves.toEqual({
      status: 'ready',
      components: { api: 'healthy', discovery: 'healthy', jwks: 'healthy' },
    })
  })

  it('reports not_ready when the api is unreachable', async () => {
    const routes = healthyRoutes()
    routes[`${API}/health/readiness`] = 'throw'
    const { impl } = fakeFetch(routes)
    const checker = createReadinessChecker({ apiUrl: API, fetchImpl: impl })

    const result = await checker.check()
    expect(result.status).toBe('not_ready')
    expect(result.components.api).toBe('unhealthy')
    expect(result.components.discovery).toBe('healthy')
  })

  it('flags a malformed discovery document', async () => {
    const routes = healthyRoutes()
    routes[`${API}/.well-known/oauth-authorization-server`] = {
      status: 200,
      body: { unexpected: true },
    }
    const { impl } = fakeFetch(routes)
    const checker = createReadinessChecker({ apiUrl: API, fetchImpl: impl })

    const result = await checker.check()
    expect(result.status).toBe('not_ready')
    expect(result.components.discovery).toBe('unhealthy')
  })

  it('flags a non-ok JWKS response', async () => {
    const routes = healthyRoutes()
    routes[`${API}/auth/jwks`] = { status: 500, body: {} }
    const { impl } = fakeFetch(routes)
    const checker = createReadinessChecker({ apiUrl: API, fetchImpl: impl })

    const result = await checker.check()
    expect(result.components.jwks).toBe('unhealthy')
    expect(result.status).toBe('not_ready')
  })

  it('caches a ready result within the TTL', async () => {
    const { impl, calls } = fakeFetch(healthyRoutes())
    let time = 1000
    const checker = createReadinessChecker({
      apiUrl: API,
      fetchImpl: impl,
      cacheTtlMs: 5000,
      now: () => time,
    })

    await checker.check()
    const firstCallCount = calls.length
    await checker.check()
    expect(calls.length).toBe(firstCallCount)

    time += 5001
    await checker.check()
    expect(calls.length).toBeGreaterThan(firstCallCount)
  })

  it('does not cache failures so recovery is observed immediately', async () => {
    const routes = healthyRoutes()
    routes[`${API}/health/readiness`] = 'throw'
    const { impl } = fakeFetch(routes)
    const checker = createReadinessChecker({ apiUrl: API, fetchImpl: impl })

    expect((await checker.check()).status).toBe('not_ready')

    // API recovers; the next probe must see it without waiting out a TTL.
    routes[`${API}/health/readiness`] = {
      status: 200,
      body: { status: 'healthy' },
    }
    await expect(checker.check()).resolves.toMatchObject({ status: 'ready' })
  })
})

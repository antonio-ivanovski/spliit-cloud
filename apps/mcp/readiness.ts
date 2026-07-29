export type ReadinessComponent = 'healthy' | 'unhealthy'

export type ReadinessResult = {
  status: 'ready' | 'not_ready'
  components: {
    api: ReadinessComponent
    discovery: ReadinessComponent
    jwks: ReadinessComponent
  }
}

export type ReadinessCheckerOptions = {
  apiUrl: string
  /** Per-probe timeout in milliseconds. */
  timeoutMs?: number
  /** How long a fully-ready result is cached to avoid probe load. */
  cacheTtlMs?: number
  now?: () => number
  fetchImpl?: typeof fetch
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Readiness probe for the MCP process. `/health` only proves the MCP can answer
 * HTTP; this additionally verifies, without sending any credential, that the
 * API an assistant depends on is reachable: its readiness endpoint, OAuth
 * discovery document, and JWKS. Successful results are cached briefly; failures
 * are never cached so recovery is observed on the next probe.
 */
export function createReadinessChecker(options: ReadinessCheckerOptions) {
  const timeoutMs = options.timeoutMs ?? 3000
  const cacheTtlMs = options.cacheTtlMs ?? 10_000
  const now = options.now ?? Date.now
  const fetchImpl = options.fetchImpl ?? fetch
  let cache: { result: ReadinessResult; expiresAt: number } | null = null

  async function probe(
    url: string,
    validate: (body: unknown) => boolean,
  ): Promise<ReadinessComponent> {
    try {
      const response = await fetchImpl(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { accept: 'application/json' },
      })
      if (!response.ok) return 'unhealthy'
      return validate(await response.json()) ? 'healthy' : 'unhealthy'
    } catch {
      return 'unhealthy'
    }
  }

  async function check(): Promise<ReadinessResult> {
    const timestamp = now()
    if (cache && cache.expiresAt > timestamp) return cache.result

    const [api, discovery, jwks] = await Promise.all([
      probe(
        `${options.apiUrl}/health/readiness`,
        (body) =>
          isRecord(body) &&
          (body.status === 'healthy' || body.status === 'unhealthy'),
      ),
      probe(
        `${options.apiUrl}/.well-known/oauth-authorization-server`,
        (body) =>
          isRecord(body) &&
          typeof body.issuer === 'string' &&
          typeof body.authorization_endpoint === 'string',
      ),
      probe(
        `${options.apiUrl}/auth/jwks`,
        (body) => isRecord(body) && Array.isArray(body.keys),
      ),
    ])

    const result: ReadinessResult = {
      status:
        api === 'healthy' && discovery === 'healthy' && jwks === 'healthy'
          ? 'ready'
          : 'not_ready',
      components: { api, discovery, jwks },
    }
    if (result.status === 'ready') {
      cache = { result, expiresAt: timestamp + cacheTtlMs }
    }
    return result
  }

  return { check }
}

import { getBossLifecycle, type SpliitBoss } from '@spliit/jobs'

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}

/** The worker exposes health only; operational job inspection is external. */
export function createAdminFetch(
  boss: SpliitBoss,
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    const url = new URL(request.url)
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405 })
    }
    if (url.pathname === '/health' || url.pathname === '/health/liveness') {
      return json({ status: 'healthy' })
    }
    if (url.pathname === '/health/readiness') {
      try {
        const lifecycle = getBossLifecycle(boss)
        const installed =
          lifecycle.state === 'running' && (await boss.isInstalled())
        return json(
          {
            status: installed ? 'healthy' : 'unhealthy',
            boss: lifecycle.state,
            ...(lifecycle.lastError ? { error: lifecycle.lastError } : {}),
          },
          installed ? 200 : 503,
        )
      } catch (error) {
        return json(
          {
            status: 'unhealthy',
            error: error instanceof Error ? error.message : String(error),
          },
          503,
        )
      }
    }
    return new Response('Not found', { status: 404 })
  }
}

export async function createDisabledHealthFetch(
  request: Request,
): Promise<Response> {
  const url = new URL(request.url)
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405 })
  }
  if (
    url.pathname === '/health' ||
    url.pathname === '/health/liveness' ||
    url.pathname === '/health/readiness'
  ) {
    return json({ status: 'healthy', jobs: 'disabled' })
  }
  return new Response('Not found', { status: 404 })
}

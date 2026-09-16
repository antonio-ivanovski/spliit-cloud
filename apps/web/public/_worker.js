const API_ORIGIN = 'https://api.spliit.cloud'

function isSpaNavigation(request) {
  if (request.method !== 'GET') return false

  const { pathname } = new globalThis.URL(request.url)
  if (
    pathname.startsWith('/assets/') ||
    pathname.startsWith('/api/') ||
    pathname === '/sw.js' ||
    pathname === '/registerSW.js' ||
    pathname === '/manifest.webmanifest'
  ) {
    return false
  }

  const mode = request.headers.get('Sec-Fetch-Mode')
  const accept = request.headers.get('Accept') ?? ''
  return mode === 'navigate' || accept.includes('text/html')
}

// OAuth/OIDC discovery documents live on the API, but agents and crawlers
// only know the web origin. Proxy them so standard discovery works from
// https://spliit.cloud without duplicating issuer metadata that would go
// stale. Static files (api-catalog, agent-card.json) never match these
// prefixes and keep serving from ASSETS below.
function isOAuthDiscoveryPath(pathname) {
  return (
    pathname === '/.well-known/oauth-protected-resource' ||
    pathname.startsWith('/.well-known/oauth-authorization-server') ||
    pathname.startsWith('/.well-known/openid-configuration')
  )
}

async function proxyOAuthDiscovery(request, pathname) {
  const requestUrl = new globalThis.URL(request.url)
  const upstream = new globalThis.URL(
    `${pathname}${requestUrl.search}`,
    API_ORIGIN,
  )
  const proxied = await globalThis.fetch(upstream.toString(), {
    method: request.method,
    headers: {
      Accept: request.headers.get('Accept') ?? 'application/json',
    },
  })
  const headers = new globalThis.Headers(proxied.headers)
  if (!headers.has('Access-Control-Allow-Origin')) {
    headers.set('Access-Control-Allow-Origin', '*')
  }
  return new globalThis.Response(proxied.body, {
    status: proxied.status,
    headers,
  })
}

export default {
  async fetch(request, env) {
    const { pathname } = new globalThis.URL(request.url)

    // Path-first on purpose: this must answer for plain machine GETs (curl,
    // scanners, crawlers) regardless of Accept or Sec-Fetch-Mode headers.
    if (
      isOAuthDiscoveryPath(pathname) &&
      (request.method === 'GET' || request.method === 'HEAD')
    ) {
      return proxyOAuthDiscovery(request, pathname)
    }

    // Machine-readable files must 404 honestly when missing. Never fall them
    // through to the SPA shell: some crawlers send Accept: text/html and
    // would otherwise receive index.html with a 200.
    if (
      pathname === '/auth.md' ||
      pathname === '/robots.txt' ||
      pathname === '/sitemap.xml' ||
      pathname.startsWith('/.well-known/')
    ) {
      return env.ASSETS.fetch(request)
    }

    const response = await env.ASSETS.fetch(request)
    if (response.status !== 404 || !isSpaNavigation(request)) {
      return response
    }

    return env.ASSETS.fetch(new globalThis.URL('/', request.url))
  },
}

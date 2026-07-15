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

export default {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request)
    if (response.status !== 404 || !isSpaNavigation(request)) {
      return response
    }

    return env.ASSETS.fetch(new globalThis.URL('/', request.url))
  },
}

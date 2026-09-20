const API_ORIGIN = 'https://api.spliit.cloud'

// Public static pages that have a hand-maintained Markdown companion. Agents
// asking for text/markdown get the companion instead of the client-rendered
// SPA shell, which contains no page content. Dynamic routes are never listed
// here and keep behaving exactly as before.
const MARKDOWN_PAGES = new Map([
  ['/', '/index.md'],
  ['/terms', '/terms.md'],
  ['/privacy', '/privacy.md'],
  ['/imprint', '/imprint.md'],
  ['/sponsor', '/sponsor.md'],
])

function acceptsMarkdown(acceptHeader) {
  if (!acceptHeader) return false

  return acceptHeader.split(',').some((entry) => {
    const [mediaType, ...parameters] = entry.trim().toLowerCase().split(';')
    if (mediaType.trim() !== 'text/markdown') return false

    const quality = parameters
      .map((parameter) => parameter.trim())
      .find((parameter) => parameter.startsWith('q='))
    return quality === undefined || Number.parseFloat(quality.slice(2)) > 0
  })
}

// Approximation for the x-markdown-tokens header; the real tokenizer is not
// available at the edge and the header is advisory only.
function estimateTokens(text) {
  return Math.ceil(text.length / 4)
}

function markdownAlternateLink(markdownPath) {
  return `<${markdownPath}>; rel="alternate"; type="text/markdown"`
}

function withMarkdownAlternate(response, markdownPath) {
  const headers = new globalThis.Headers(response.headers)
  headers.set('Vary', 'Accept')
  headers.append('Link', markdownAlternateLink(markdownPath))
  return new globalThis.Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

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

// OAuth/OIDC discovery documents and Digital Asset Links live on the API,
// but agents, crawlers and (for assetlinks) Android / Play verifiers only
// know the web origin. Proxy them so standard discovery works from
// https://spliit.cloud without duplicating issuer metadata that would go
// stale. Static files (api-catalog, agent-card.json) never match these
// prefixes and keep serving from ASSETS below.
function isApiHostedWellKnownPath(pathname) {
  return (
    pathname === '/.well-known/oauth-protected-resource' ||
    pathname.startsWith('/.well-known/oauth-authorization-server') ||
    pathname.startsWith('/.well-known/openid-configuration') ||
    pathname === '/.well-known/assetlinks.json'
  )
}

async function proxyWellKnownToApi(request, pathname) {
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
      isApiHostedWellKnownPath(pathname) &&
      (request.method === 'GET' || request.method === 'HEAD')
    ) {
      return proxyWellKnownToApi(request, pathname)
    }

    // Machine-readable files must 404 honestly when missing. Never fall them
    // through to the SPA shell: some crawlers send Accept: text/html and
    // would otherwise receive index.html with a 200.
    if (
      pathname.endsWith('.md') ||
      pathname === '/robots.txt' ||
      pathname === '/sitemap.xml' ||
      pathname.startsWith('/.well-known/')
    ) {
      return env.ASSETS.fetch(request)
    }

    const markdownPath = MARKDOWN_PAGES.get(pathname)
    if (
      markdownPath !== undefined &&
      (request.method === 'GET' || request.method === 'HEAD') &&
      acceptsMarkdown(request.headers.get('Accept'))
    ) {
      const isHead = request.method === 'HEAD'
      const markdownResponse = await env.ASSETS.fetch(
        new globalThis.Request(new globalThis.URL(markdownPath, request.url), {
          method: request.method,
        }),
      )

      if (markdownResponse.ok) {
        const markdown = isHead ? '' : await markdownResponse.text()
        const headers = new globalThis.Headers(markdownResponse.headers)
        headers.set('Content-Type', 'text/markdown; charset=utf-8')
        headers.set('Vary', 'Accept')
        headers.set('Cache-Control', 'no-cache, max-age=0, must-revalidate')
        if (!isHead) {
          headers.set('x-markdown-tokens', String(estimateTokens(markdown)))
        }
        return new globalThis.Response(isHead ? null : markdown, {
          status: markdownResponse.status,
          headers,
        })
      }
      // A missing companion must not break the request: fall through to the
      // normal asset / SPA handling below, which 404s honestly for agents.
    }

    const response = await env.ASSETS.fetch(request)
    if (response.status !== 404 || !isSpaNavigation(request)) {
      return markdownPath === undefined
        ? response
        : withMarkdownAlternate(response, markdownPath)
    }

    const spaResponse = await env.ASSETS.fetch(
      new globalThis.URL('/', request.url),
    )
    return markdownPath === undefined
      ? spaResponse
      : withMarkdownAlternate(spaResponse, markdownPath)
  },
}

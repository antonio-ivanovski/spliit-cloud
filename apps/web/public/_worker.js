const API_ORIGIN = 'https://api.spliit.cloud'
const SITE_ORIGIN = 'https://spliit.cloud'
const OG_IMAGE = `${SITE_ORIGIN}/screenshots/desktop-overview-1280x720.png`

// Crawler-visible head per public route. index.html ships the `/` variant as a
// static fallback; the worker rewrites the same tags per pathname so every
// public URL serves correct title/description/canonical without client JS.
// Keep titles/descriptions in sync with the Markdown companions' frontmatter.
const SEO_META = new Map([
  [
    '/',
    {
      title: 'Spliit Cloud — Share expenses with friends & family',
      description:
        'Track shared expenses and settle up. Free and open source, synced and secured by your account.',
    },
  ],
  [
    '/privacy',
    {
      title: 'Privacy notice — Spliit Cloud',
      description:
        'How the public Spliit Cloud instance handles personal data when you use it.',
    },
  ],
  [
    '/terms',
    {
      title: 'Terms of use — Spliit Cloud',
      description:
        'Terms of use for Spliit Cloud, a free, non-commercial, community-maintained shared expense tracker.',
    },
  ],
  [
    '/imprint',
    {
      title: 'Project notice — Spliit Cloud',
      description:
        'Project notice and public contact channel for Spliit Cloud, a non-commercial, community-maintained software project.',
    },
  ],
  [
    '/sponsor',
    {
      title: 'Support Spliit Cloud',
      description:
        'Spliit Cloud is a non-commercial, community-maintained project. If it helps you split expenses with friends and family, consider chipping in for hosting and development.',
    },
  ],
  [
    '/support',
    {
      title: 'Support — Spliit Cloud',
      description:
        'How to get help with Spliit Cloud, report bugs, and contact the community maintainers.',
    },
  ],
  [
    '/features',
    {
      title: 'Features — Spliit Cloud',
      description:
        'Every Spliit feature in one catalog: sign-in, smart splits, the installable app, imports, and an open developer platform.',
    },
  ],
])

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
  ['/support', '/support.md'],
  ['/features', '/features.md'],
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

function normalizeSeoPathname(pathname) {
  return pathname.length > 1 && pathname.endsWith('/')
    ? pathname.slice(0, -1)
    : pathname
}

function escapeHtmlAttr(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function escapeHtmlText(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function seoJsonLd(seoPath, meta, canonicalUrl) {
  if (seoPath === '/') {
    return {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'WebSite',
          name: 'Spliit Cloud',
          url: `${SITE_ORIGIN}/`,
          inLanguage: 'en',
        },
        {
          '@type': 'Organization',
          name: 'Spliit Cloud',
          url: `${SITE_ORIGIN}/`,
          logo: `${SITE_ORIGIN}/logo.svg`,
          sameAs: ['https://github.com/antonio-ivanovski/spliit-cloud'],
        },
        {
          '@type': 'WebApplication',
          name: 'Spliit Cloud',
          url: `${SITE_ORIGIN}/`,
          applicationCategory: 'FinanceApplication',
          operatingSystem: 'Web',
          inLanguage: 'en',
          description: meta.description,
          offers: { '@type': 'Offer', price: '0' },
          sameAs: ['https://github.com/antonio-ivanovski/spliit-cloud'],
        },
      ],
    }
  }
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: meta.title,
    description: meta.description,
    url: canonicalUrl,
    isPartOf: {
      '@type': 'WebSite',
      name: 'Spliit Cloud',
      url: `${SITE_ORIGIN}/`,
    },
  }
}

function replaceOrInsertMeta(html, pattern, tag) {
  if (pattern.test(html)) return html.replace(pattern, tag)
  return html.replace(/<\/title>/, `</title>${tag}`)
}

function injectSeoMeta(html, seoPath, meta) {
  const canonicalUrl =
    seoPath === '/' ? `${SITE_ORIGIN}/` : `${SITE_ORIGIN}${seoPath}`
  const markdownHref = seoPath === '/' ? '/index.md' : `${seoPath}.md`
  const titleText = escapeHtmlText(meta.title)
  const titleAttr = escapeHtmlAttr(meta.title)
  const descriptionAttr = escapeHtmlAttr(meta.description)

  let next = html.replace(/<title>.*?<\/title>/s, `<title>${titleText}</title>`)
  next = replaceOrInsertMeta(
    next,
    /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/s,
    `<meta name="description" content="${descriptionAttr}">`,
  )
  next = replaceOrInsertMeta(
    next,
    /<link\s+rel="canonical"\s+href="[^"]*"\s*\/?>/s,
    `<link rel="canonical" href="${canonicalUrl}">`,
  )
  next = replaceOrInsertMeta(
    next,
    /<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>/s,
    `<meta property="og:title" content="${titleAttr}">`,
  )
  next = replaceOrInsertMeta(
    next,
    /<meta\s+property="og:description"\s+content="[^"]*"\s*\/?>/s,
    `<meta property="og:description" content="${descriptionAttr}">`,
  )
  next = replaceOrInsertMeta(
    next,
    /<meta\s+property="og:url"\s+content="[^"]*"\s*\/?>/s,
    `<meta property="og:url" content="${canonicalUrl}">`,
  )
  next = replaceOrInsertMeta(
    next,
    /<meta\s+name="twitter:title"\s+content="[^"]*"\s*\/?>/s,
    `<meta name="twitter:title" content="${titleAttr}">`,
  )
  next = replaceOrInsertMeta(
    next,
    /<meta\s+name="twitter:description"\s+content="[^"]*"\s*\/?>/s,
    `<meta name="twitter:description" content="${descriptionAttr}">`,
  )
  next = replaceOrInsertMeta(
    next,
    /<meta\s+property="og:image"\s+content="[^"]*"\s*\/?>/s,
    `<meta property="og:image" content="${OG_IMAGE}">`,
  )
  next = replaceOrInsertMeta(
    next,
    /<meta\s+name="twitter:image"\s+content="[^"]*"\s*\/?>/s,
    `<meta name="twitter:image" content="${OG_IMAGE}">`,
  )
  if (/<link\s+rel="alternate"\s+type="text\/markdown"/s.test(next)) {
    next = next.replace(
      /<link\s+rel="alternate"\s+type="text\/markdown"[^>]*>/s,
      `<link rel="alternate" type="text/markdown" title="Spliit Cloud in plain text" href="${markdownHref}">`,
    )
  }
  const jsonLd = JSON.stringify(seoJsonLd(seoPath, meta, canonicalUrl)).replace(
    /</g,
    '\\u003c',
  )
  if (/<script\s+type="application\/ld\+json">.*?<\/script>/s.test(next)) {
    next = next.replace(
      /<script\s+type="application\/ld\+json">.*?<\/script>/s,
      `<script type="application/ld+json">${jsonLd}</script>`,
    )
  }
  return next
}

async function withSeoMeta(response, seoPath, meta) {
  const contentType = response.headers.get('Content-Type') ?? ''
  if (!contentType.includes('text/html')) return response
  const html = await response.text()
  if (!html.includes('<title>')) return response
  const headers = new globalThis.Headers(response.headers)
  headers.delete('Content-Length')
  return new globalThis.Response(injectSeoMeta(html, seoPath, meta), {
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

    const markdownPath =
      MARKDOWN_PAGES.get(pathname) ??
      MARKDOWN_PAGES.get(normalizeSeoPathname(pathname))
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
    const seoPath = normalizeSeoPathname(pathname)
    const seoMeta = request.method === 'GET' ? SEO_META.get(seoPath) : undefined
    if (response.status !== 404 || !isSpaNavigation(request)) {
      const withSeo =
        seoMeta === undefined
          ? response
          : await withSeoMeta(response, seoPath, seoMeta)
      return markdownPath === undefined
        ? withSeo
        : withMarkdownAlternate(withSeo, markdownPath)
    }

    const spaResponse = await env.ASSETS.fetch(
      new globalThis.URL('/', request.url),
    )
    const spaWithSeo =
      seoMeta === undefined
        ? spaResponse
        : await withSeoMeta(spaResponse, seoPath, seoMeta)
    return markdownPath === undefined
      ? spaWithSeo
      : withMarkdownAlternate(spaWithSeo, markdownPath)
  },
}

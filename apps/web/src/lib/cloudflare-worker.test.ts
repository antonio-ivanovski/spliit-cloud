import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it, vi } from 'vitest'

// The Pages worker is intentionally kept as a plain JavaScript asset because
// Cloudflare loads public/_worker.js directly at deploy time.
// @ts-ignore -- no TypeScript module declaration is needed for the Pages asset
import pagesWorker from '../../public/_worker.js'

type AssetInput = Request | URL
type WorkerEnvironment = {
  ASSETS: {
    fetch: (input: AssetInput) => Promise<Response>
  }
}
type PagesWorker = {
  fetch: (request: Request, env: WorkerEnvironment) => Promise<Response>
}

const worker = pagesWorker as PagesWorker

const machineReadablePaths = ['/robots.txt', '/sitemap.xml'] as const

function requestFor(pathname: string, { accept = 'text/html' } = {}) {
  return new Request(`https://spliit.cloud${pathname}`, {
    headers: {
      Accept: accept,
      'Sec-Fetch-Mode': 'navigate',
    },
  })
}

function requestWithAccept(pathname: string, accept: string) {
  return new Request(`https://spliit.cloud${pathname}`, {
    headers: { Accept: accept },
  })
}

function pathnameFrom(input: AssetInput) {
  return new URL(input instanceof Request ? input.url : input.toString())
    .pathname
}

const publicDir = fileURLToPath(new URL('../../public', import.meta.url))
const workerSource = readFileSync(
  new URL('../../public/_worker.js', import.meta.url),
  'utf8',
)

const markdownPages = [
  ...workerSource.matchAll(/\[\s*'([^']+)',\s*'(\/[^']+\.md)'\s*\]/g),
].map(([, page = '', asset = '']) => ({ page, asset }))

describe('Cloudflare Pages worker machine-readable files', () => {
  it.each(machineReadablePaths)(
    'returns the %s asset without SPA fallback for HTML navigation',
    async (pathname) => {
      const assetResponse = new Response(`${pathname} asset`, { status: 200 })
      const fetchAsset = vi.fn(async (input: AssetInput) => {
        if (pathnameFrom(input) === pathname) return assetResponse
        return new Response('SPA shell', { status: 200 })
      })

      const response = await worker.fetch(requestFor(pathname), {
        ASSETS: { fetch: fetchAsset },
      })

      expect(response).toBe(assetResponse)
      expect(await response.text()).toBe(`${pathname} asset`)
      expect(fetchAsset).toHaveBeenCalledTimes(1)
    },
  )

  it.each(machineReadablePaths)(
    'preserves a missing %s response instead of serving the SPA shell',
    async (pathname) => {
      const fetchAsset = vi.fn(async (input: AssetInput) => {
        if (pathnameFrom(input) === pathname) {
          return new Response('Not found', { status: 404 })
        }
        return new Response('SPA shell', { status: 200 })
      })

      const response = await worker.fetch(requestFor(pathname), {
        ASSETS: { fetch: fetchAsset },
      })

      expect(response.status).toBe(404)
      expect(await response.text()).toBe('Not found')
      expect(fetchAsset).toHaveBeenCalledTimes(1)
    },
  )
})

describe('Cloudflare Pages worker markdown negotiation', () => {
  it('maps every negotiated page to an existing markdown companion', () => {
    expect(markdownPages).toEqual([
      { page: '/', asset: '/index.md' },
      { page: '/terms', asset: '/terms.md' },
      { page: '/privacy', asset: '/privacy.md' },
      { page: '/imprint', asset: '/imprint.md' },
      { page: '/sponsor', asset: '/sponsor.md' },
      { page: '/support', asset: '/support.md' },
      { page: '/features', asset: '/features.md' },
    ])

    const publicMarkdownAssets = readdirSync(publicDir)
      .filter((file) => file.endsWith('.md') && file !== 'auth.md')
      .map((file) => `/${file}`)
      .sort()
    expect(markdownPages.map(({ asset }) => asset).sort()).toEqual(
      publicMarkdownAssets,
    )

    for (const { asset } of markdownPages) {
      expect(existsSync(join(publicDir, asset)), asset).toBe(true)
    }

    for (const file of publicMarkdownAssets) {
      if (file === '/auth.md') continue
      expect(existsSync(join(publicDir, file)), file).toBe(true)
    }
  })

  it.each(markdownPages)(
    'serves the $asset companion for $page to markdown clients',
    async ({ page, asset }) => {
      const markdown = `# ${page}\n\nMarkdown body.`
      const requestedPaths: string[] = []
      const fetchAsset = vi.fn(async (input: AssetInput) => {
        const pathname = pathnameFrom(input)
        requestedPaths.push(pathname)
        if (pathname === asset) {
          return new Response(markdown, { status: 200 })
        }
        return new Response('SPA shell', { status: 200 })
      })

      const response = await worker.fetch(
        requestWithAccept(page, 'text/markdown'),
        { ASSETS: { fetch: fetchAsset } },
      )

      expect(response.status).toBe(200)
      expect(await response.text()).toBe(markdown)
      expect(response.headers.get('Content-Type')).toBe(
        'text/markdown; charset=utf-8',
      )
      expect(response.headers.get('Vary')).toBe('Accept')
      expect(response.headers.get('x-markdown-tokens')).toBe(
        String(Math.ceil(markdown.length / 4)),
      )
      expect(requestedPaths).toEqual([asset])
    },
  )

  it('keeps serving the HTML SPA shell to browsers', async () => {
    const fetchAsset = vi.fn(async (input: AssetInput) => {
      if (pathnameFrom(input) === '/') {
        return new Response('SPA shell', { status: 200 })
      }
      return new Response('Not found', { status: 404 })
    })

    const response = await worker.fetch(requestFor('/terms'), {
      ASSETS: { fetch: fetchAsset },
    })

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('SPA shell')
    expect(response.headers.get('Vary')).toBe('Accept')
    expect(response.headers.get('Link')).toBe(
      '</terms.md>; rel="alternate"; type="text/markdown"',
    )
    expect(response.headers.get('x-markdown-tokens')).toBeNull()
  })

  it('ignores markdown preferences with zero quality', async () => {
    const fetchAsset = vi.fn(async (input: AssetInput) => {
      if (pathnameFrom(input) === '/') {
        return new Response('SPA shell', { status: 200 })
      }
      return new Response('Not found', { status: 404 })
    })

    const response = await worker.fetch(
      requestFor('/terms', { accept: 'text/markdown;q=0, text/html' }),
      { ASSETS: { fetch: fetchAsset } },
    )

    expect(await response.text()).toBe('SPA shell')
    expect(response.headers.get('x-markdown-tokens')).toBeNull()
  })

  it('ignores wildcard accepts on the homepage', async () => {
    const fetchAsset = vi.fn(async () => new Response('SPA shell'))

    const response = await worker.fetch(requestWithAccept('/', '*/*'), {
      ASSETS: { fetch: fetchAsset },
    })

    expect(await response.text()).toBe('SPA shell')
    expect(response.headers.get('Vary')).toBe('Accept')
  })

  it('serves direct markdown requests without SPA fallback', async () => {
    const assetResponse = new Response('# Terms', { status: 200 })
    const fetchAsset = vi.fn(async (input: AssetInput) => {
      if (pathnameFrom(input) === '/terms.md') return assetResponse
      return new Response('SPA shell', { status: 200 })
    })

    const response = await worker.fetch(requestFor('/terms.md'), {
      ASSETS: { fetch: fetchAsset },
    })

    expect(response).toBe(assetResponse)
    expect(fetchAsset).toHaveBeenCalledTimes(1)
  })

  it('404s an unknown markdown page instead of serving the SPA shell', async () => {
    const fetchAsset = vi.fn(async (input: AssetInput) => {
      if (pathnameFrom(input) === '/missing.md') {
        return new Response('Not found', { status: 404 })
      }
      return new Response('SPA shell', { status: 200 })
    })

    const response = await worker.fetch(requestFor('/missing.md'), {
      ASSETS: { fetch: fetchAsset },
    })

    expect(response.status).toBe(404)
    expect(fetchAsset).toHaveBeenCalledTimes(1)
  })

  it('does not crash when a companion is missing', async () => {
    const fetchAsset = vi.fn(
      async () => new Response('Not found', { status: 404 }),
    )

    const response = await worker.fetch(
      requestWithAccept('/terms', 'text/markdown'),
      { ASSETS: { fetch: fetchAsset } },
    )

    expect(response.status).toBe(404)
  })

  it('omits token headers for HEAD markdown requests', async () => {
    const fetchAsset = vi.fn(async (input: AssetInput) => {
      if (pathnameFrom(input) === '/terms.md') {
        return new Response('# Terms', { status: 200 })
      }
      return new Response('SPA shell', { status: 200 })
    })

    const request = new Request('https://spliit.cloud/terms', {
      method: 'HEAD',
      headers: { Accept: 'text/markdown' },
    })
    const response = await worker.fetch(request, {
      ASSETS: { fetch: fetchAsset },
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe(
      'text/markdown; charset=utf-8',
    )
    expect(response.headers.get('x-markdown-tokens')).toBeNull()
    expect(await response.text()).toBe('')
  })
})

describe('Cloudflare Pages worker SEO head injection', () => {
  const htmlShell = (title = 'Old title', withNoscript = true) =>
    `<!doctype html><html lang="en"><head><title>${title}</title><meta name="description" content="Old description"><link rel="canonical" href="https://spliit.cloud/old"><meta property="og:title" content="Old"><meta property="og:description" content="Old"><meta property="og:url" content="https://spliit.cloud/old"><meta name="twitter:title" content="Old"><meta name="twitter:description" content="Old"><meta property="og:image" content="https://spliit.cloud/old.png"><meta name="twitter:image" content="https://spliit.cloud/old.png"><link rel="alternate" type="text/markdown" title="Old" href="/old.md"><script type="application/ld+json">{"old":true}</script></head><body><div id="root"></div>${withNoscript ? '<noscript id="crawler-fallback"><h1 data-seo="title">Old title</h1><p data-seo="description">Old description</p><p><a data-seo="markdown" href="/old.md">Read this page in plain text (Markdown)</a></p><nav><a href="/terms">Terms</a></nav></noscript>' : ''}</body></html>`

  const htmlResponse = (title = 'Old title', withNoscript = true) =>
    new Response(htmlShell(title, withNoscript), {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })

  it('rewrites the homepage head with the canonical SEO title and description', async () => {
    const fetchAsset = vi.fn(async () => htmlResponse())

    const response = await worker.fetch(requestFor('/'), {
      ASSETS: { fetch: fetchAsset },
    })

    const html = await response.text()
    expect(html).toContain(
      '<title>Spliit Cloud — Share expenses with friends &amp; family</title>',
    )
    expect(html).toContain(
      '<meta name="description" content="Track shared expenses and settle up. Free and open source, synced and secured by your account.">',
    )
    expect(html).toContain(
      '<link rel="canonical" href="https://spliit.cloud/">',
    )
    expect(html).toContain(
      '<meta property="og:url" content="https://spliit.cloud/">',
    )
    expect(html).toContain('"@type":"WebApplication"')
    expect(html).toContain('href="/index.md"')
    expect(response.headers.get('Link')).toBe(
      '</index.md>; rel="alternate"; type="text/markdown"',
    )
  })

  it('rewrites the SPA fallback shell for /privacy with its own canonical', async () => {
    const fetchAsset = vi.fn(async (input: AssetInput) => {
      if (pathnameFrom(input) === '/') return htmlResponse()
      return new Response('Not found', { status: 404 })
    })

    const response = await worker.fetch(requestFor('/privacy'), {
      ASSETS: { fetch: fetchAsset },
    })

    const html = await response.text()
    expect(html).toContain('<title>Privacy notice — Spliit Cloud</title>')
    expect(html).toContain('How the public Spliit Cloud instance handles')
    expect(html).toContain(
      '<link rel="canonical" href="https://spliit.cloud/privacy">',
    )
    expect(html).toContain('"@type":"WebPage"')
    expect(html).toContain('href="/privacy.md"')
  })

  it('rewrites the SPA fallback shell for /features with its own canonical', async () => {
    const fetchAsset = vi.fn(async (input: AssetInput) => {
      if (pathnameFrom(input) === '/') return htmlResponse()
      return new Response('Not found', { status: 404 })
    })

    const response = await worker.fetch(requestFor('/features'), {
      ASSETS: { fetch: fetchAsset },
    })

    const html = await response.text()
    expect(html).toContain('<title>Features — Spliit Cloud</title>')
    expect(html).toContain('Every Spliit Cloud feature in one catalog')
    expect(html).toContain(
      '<link rel="canonical" href="https://spliit.cloud/features">',
    )
    expect(html).toContain('"@type":"WebPage"')
    expect(html).toContain('href="/features.md"')
    expect(html).toContain('<h1 data-seo="title">Features — Spliit Cloud</h1>')
    expect(html).toContain(
      '<p data-seo="description">Every Spliit Cloud feature in one catalog',
    )
    expect(html).toContain('<a data-seo="markdown" href="/features.md">')
    expect(html).not.toContain('href="/old.md"')
    expect(html).toContain('<a href="/terms">Terms</a>')
  })

  it('inserts a minimal crawler fallback when the shell has none', async () => {
    const fetchAsset = vi.fn(async (input: AssetInput) => {
      if (pathnameFrom(input) === '/') return htmlResponse('Old title', false)
      return new Response('Not found', { status: 404 })
    })

    const response = await worker.fetch(requestFor('/support'), {
      ASSETS: { fetch: fetchAsset },
    })

    const html = await response.text()
    expect(html).toContain('<title>Support — Spliit Cloud</title>')
    expect(html).toContain('<noscript id="crawler-fallback">')
    expect(html).toContain('<h1 data-seo="title">Support — Spliit Cloud</h1>')
    expect(html).toContain('<a data-seo="markdown" href="/support.md">')
  })

  it('normalizes trailing slashes to the canonical path', async () => {
    const fetchAsset = vi.fn(async (input: AssetInput) => {
      if (pathnameFrom(input) === '/') return htmlResponse()
      return new Response('Not found', { status: 404 })
    })

    const response = await worker.fetch(requestFor('/terms/'), {
      ASSETS: { fetch: fetchAsset },
    })

    const html = await response.text()
    expect(html).toContain('<title>Terms of use — Spliit Cloud</title>')
    expect(html).toContain(
      '<link rel="canonical" href="https://spliit.cloud/terms">',
    )
    expect(response.headers.get('Link')).toBe(
      '</terms.md>; rel="alternate"; type="text/markdown"',
    )
  })

  it('leaves app routes without SEO metadata untouched', async () => {
    const fetchAsset = vi.fn(async (input: AssetInput) => {
      if (pathnameFrom(input) === '/') return htmlResponse('App shell')
      return new Response('Not found', { status: 404 })
    })

    const response = await worker.fetch(requestFor('/groups/abc123'), {
      ASSETS: { fetch: fetchAsset },
    })

    expect(await response.text()).toContain('<title>App shell</title>')
    expect(response.headers.get('Link')).toBeNull()
  })

  it('leaves non-HTML responses untouched', async () => {
    const jsonFetch = vi.fn(
      async () =>
        new Response('{"ok":true}', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    )

    const response = await worker.fetch(requestFor('/'), {
      ASSETS: { fetch: jsonFetch },
    })

    expect(response.headers.get('Content-Type')).toBe('application/json')
    expect(await response.text()).toBe('{"ok":true}')
  })
})

describe('Cloudflare Pages worker group share unfurls', () => {
  const groupShell = () =>
    `<!doctype html><html lang="en"><head><title>Spliit Cloud — Share expenses with friends &amp; family</title><meta property="og:title" content="Spliit Cloud"><meta property="og:description" content="Spliit Cloud"><meta property="og:url" content="https://spliit.cloud/"><meta name="twitter:title" content="Spliit Cloud"><meta name="twitter:description" content="Spliit Cloud"><meta property="og:image" content="https://spliit.cloud/screenshots/desktop-overview-1280x720.png"><meta property="og:image:width" content="1280"><meta property="og:image:height" content="720"><meta property="og:image:alt" content="Spliit Cloud group overview"><meta name="twitter:image" content="https://spliit.cloud/screenshots/desktop-overview-1280x720.png"><link rel="canonical" href="https://spliit.cloud/"></head><body><div id="root"></div></body></html>`

  function crawlerRequestFor(pathname: string) {
    return new Request(`https://spliit.cloud${pathname}`, {
      headers: {
        Accept: 'text/html',
        'Sec-Fetch-Mode': 'navigate',
        'User-Agent':
          'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
      },
    })
  }

  function assetFetchForShell() {
    return vi.fn(async (input: AssetInput) => {
      if (pathnameFrom(input) === '/') {
        return new Response(groupShell(), {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      }
      return new Response('Not found', { status: 404 })
    })
  }

  function stubPreviewApi(preview: unknown) {
    const apiFetch = vi.fn(
      async () =>
        new Response(JSON.stringify(preview), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    )
    vi.stubGlobal('fetch', apiFetch)
    return apiFetch
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('injects group invite tags for crawlers', async () => {
    const apiFetch = stubPreviewApi({
      kind: 'invite',
      preview: {
        group: { id: 'grp-1', name: 'Summer Trip', groupType: 'GROUP' },
        inviter: { name: 'Alice' },
        temporaryName: 'Bob',
        usable: true,
        memberCount: 3,
      },
    })

    const response = await worker.fetch(
      crawlerRequestFor('/groups/grp-1?invite=secret-token'),
      { ASSETS: { fetch: assetFetchForShell() } },
    )

    const html = await response.text()
    expect(html).toContain('<title>Join Summer Trip on Spliit Cloud</title>')
    expect(html).toContain('Alice invited you to join Summer Trip')
    expect(html).toContain(`You'll join as Bob`)
    expect(html).toContain(
      'https://api.spliit.cloud/api/og/group-card.png?invite=secret-token',
    )
    expect(html).toContain('<meta property="og:image:width" content="1200">')
    expect(html).toContain('<meta property="og:image:height" content="630">')
    // Share secrets stay out of indexing signals.
    expect(html).toContain(
      '<link rel="canonical" href="https://spliit.cloud/">',
    )
    // The response varies by crawler UA, so shared caches must key on it.
    expect(response.headers.get('Vary')).toMatch(/user-agent/i)
    expect(apiFetch).toHaveBeenCalledTimes(1)
  })

  it('injects read-only view tags for crawlers', async () => {
    stubPreviewApi({
      kind: 'view',
      preview: {
        group: { id: 'grp-1', name: 'Apartment' },
        memberCount: 2,
        usable: true,
      },
    })

    const response = await worker.fetch(
      crawlerRequestFor('/groups/grp-1?viewKey=view-secret'),
      { ASSETS: { fetch: assetFetchForShell() } },
    )

    const html = await response.text()
    expect(html).toContain('<title>Apartment on Spliit Cloud</title>')
    expect(html).toContain('2 members · shared read-only view')
    expect(html).toContain('groupId=grp-1&amp;viewKey=view-secret')
  })

  it('hides group details for used-up invite links', async () => {
    stubPreviewApi({
      kind: 'invite',
      preview: {
        group: { id: 'grp-1', name: 'Summer Trip', groupType: 'GROUP' },
        inviter: { name: 'Alice' },
        usable: false,
        reason: 'accepted',
      },
    })

    const response = await worker.fetch(
      crawlerRequestFor('/groups/grp-1?invite=used-token'),
      { ASSETS: { fetch: assetFetchForShell() } },
    )

    const html = await response.text()
    expect(html).toContain(
      '<title>Spliit Cloud — Share expenses with friends &amp; family</title>',
    )
    expect(html).toContain('This invite link is no longer valid.')
    expect(html).not.toContain('Join Summer Trip')
  })

  it('leaves browsers on the instant static shell without a preview fetch', async () => {
    const apiFetch = vi.fn(async () => new Response('{}'))
    vi.stubGlobal('fetch', apiFetch)

    const response = await worker.fetch(
      requestFor('/groups/grp-1?invite=secret-token'),
      { ASSETS: { fetch: assetFetchForShell() } },
    )

    const html = await response.text()
    expect(html).toContain(
      '<title>Spliit Cloud — Share expenses with friends &amp; family</title>',
    )
    expect(html).not.toContain('/api/og/group-card.png')
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('falls back to the generic card when the preview API fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('upstream down')
      }),
    )

    const response = await worker.fetch(
      crawlerRequestFor('/groups/grp-1?invite=secret-token'),
      { ASSETS: { fetch: assetFetchForShell() } },
    )

    const html = await response.text()
    expect(html).toContain(
      '<title>Spliit Cloud — Share expenses with friends &amp; family</title>',
    )
    expect(html).toContain(
      'https://spliit.cloud/screenshots/desktop-overview-1280x720.png',
    )
  })
})

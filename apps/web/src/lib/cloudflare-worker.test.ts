import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it, vi } from 'vitest'

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
    ])

    for (const { asset } of markdownPages) {
      expect(existsSync(join(publicDir, asset)), asset).toBe(true)
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

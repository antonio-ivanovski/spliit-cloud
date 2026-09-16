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

function requestFor(pathname: string) {
  return new Request(`https://spliit.cloud${pathname}`, {
    headers: {
      Accept: 'text/html',
      'Sec-Fetch-Mode': 'navigate',
    },
  })
}

function pathnameFrom(input: AssetInput) {
  return new URL(input instanceof Request ? input.url : input.toString())
    .pathname
}

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

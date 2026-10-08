import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Exercise the worker's real Workbox routes. A navigation to `/` can also
// match the index.html precache route, so pathname predicates alone cannot
// catch this regression. The browser boundary below models an installed
// HTML response whose Vary header requires the precaching request headers.
const origin = 'https://spliit.cloud'
const cacheKey = `${origin}/index.html?__WB_REVISION__=shell-v1`
const NativeRequest = Request

class WorkerRequest extends NativeRequest {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    super(typeof input === 'string' ? new URL(input, origin) : input, init)
  }
}

describe('service worker offline app-shell navigation', () => {
  let fetchListeners: ((event: FetchEvent) => void)[]
  let fetchNetwork: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.resetModules()
    fetchListeners = []
    const location = new URL(`${origin}/sw.js`)
    vi.stubGlobal('location', location)
    vi.stubGlobal('FetchEvent', Event)
    vi.stubGlobal('ExtendableEvent', Event)
    vi.stubGlobal('__WB_DISABLE_DEV_LOGS', true)
    vi.stubGlobal('registration', { scope: `${origin}/` })
    vi.stubGlobal('Request', WorkerRequest)
    vi.stubGlobal('self', {
      location,
      __WB_DISABLE_DEV_LOGS: true,
      __WB_MANIFEST: [
        { url: 'index.html', revision: 'shell-v1' },
        { url: 'logo.svg', revision: 'logo-v1' },
      ],
      addEventListener: (
        type: string,
        listener: (event: FetchEvent) => void,
      ) => {
        if (type === 'fetch') fetchListeners.push(listener)
      },
    })

    const storedRequest = new WorkerRequest(cacheKey)
    const storedResponse = new Response('<html>Spliit offline shell</html>', {
      headers: { 'Content-Type': 'text/html', Vary: 'Accept' },
    })
    vi.stubGlobal('caches', {
      match: async (request: Request) => {
        if (request.url === `${origin}/logo.svg?__WB_REVISION__=logo-v1`) {
          return new Response('<svg>Logo</svg>')
        }
        if (request.url !== storedRequest.url) return undefined
        const vary = storedResponse.headers.get('Vary')!.split(',')
        if (
          vary.some(
            (header) =>
              request.headers.get(header.trim()) !==
              storedRequest.headers.get(header.trim()),
          )
        ) {
          return undefined
        }
        return storedResponse.clone()
      },
    })
    fetchNetwork = vi.fn().mockRejectedValue(new TypeError('Network offline'))
    vi.stubGlobal('fetch', fetchNetwork)

    await import('./sw')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each([
    ...['/', '/index.html', '/?utm_source=installed', '/groups/example'].map(
      (pathname) => ({
        pathname,
        body: '<html>Spliit offline shell</html>',
      }),
    ),
    { pathname: '/logo.svg', body: '<svg>Logo</svg>' },
  ])(
    'loads $pathname from its cache while offline',
    async ({ pathname, body }) => {
      const request = new WorkerRequest(`${origin}${pathname}`, {
        headers: { Accept: 'text/html,application/xhtml+xml' },
      })
      // Native Node Request cannot construct mode:navigate; browsers set it
      // themselves for document loads.
      Object.defineProperty(request, 'mode', { value: 'navigate' })
      const lifetime: Promise<unknown>[] = []
      let response: Promise<Response> | undefined
      const event = Object.assign(new Event('fetch'), {
        request,
        waitUntil: (promise: Promise<unknown>) => lifetime.push(promise),
        respondWith: (promise: Promise<Response>) => {
          response = promise
        },
      }) as unknown as FetchEvent
      for (const listener of fetchListeners) listener(event)

      // Settle lifetime promises even on the pre-fix rejection so the failed
      // regression does not leave unhandled Workbox rejections behind.
      const result = await Promise.allSettled([response, ...lifetime])
      if (result[0]?.status === 'rejected') throw result[0].reason
      const shell = await response
      expect(shell?.status).toBe(200)
      expect(await shell?.text()).toBe(body)
      expect(fetchNetwork).not.toHaveBeenCalled()
    },
  )
})

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

describe('service worker locale chunk runtime cache', () => {
  let fetchListeners: ((event: FetchEvent) => void)[]
  let fetchNetwork: ReturnType<typeof vi.fn>
  let runtimeEntries: Map<string, Response>

  function dispatchFetch(pathname: string) {
    const request = new WorkerRequest(`${origin}${pathname}`)
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
    return { response: response as Promise<Response>, lifetime }
  }

  beforeEach(async () => {
    vi.resetModules()
    fetchListeners = []
    runtimeEntries = new Map()
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
      __WB_MANIFEST: [{ url: 'index.html', revision: 'shell-v1' }],
      addEventListener: (
        type: string,
        listener: (event: FetchEvent) => void,
      ) => {
        if (type === 'fetch') fetchListeners.push(listener)
      },
    })
    const runtimeCache = {
      match: async (request: Request) =>
        runtimeEntries.get(request.url)?.clone() ?? undefined,
      put: async (request: Request, response: Response) => {
        runtimeEntries.set(request.url, response.clone())
      },
      keys: async () =>
        [...runtimeEntries.keys()].map((url) => new WorkerRequest(url)),
      delete: async (request: Request) => runtimeEntries.delete(request.url),
    }
    vi.stubGlobal('caches', {
      match: async () => undefined,
      open: async () => runtimeCache,
    })
    fetchNetwork = vi.fn().mockRejectedValue(new TypeError('Network offline'))
    vi.stubGlobal('fetch', fetchNetwork)

    await import('./sw')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('serves a cached locale chunk offline without touching the network', async () => {
    runtimeEntries.set(
      `${origin}/assets/fr-FR-AbC123.js`,
      new Response('locale-bundle'),
    )

    const { response, lifetime } = dispatchFetch('/assets/fr-FR-AbC123.js')
    const result = await Promise.allSettled([response, ...lifetime])
    if (result[0]?.status === 'rejected') throw result[0].reason
    expect(await (await response)?.text()).toBe('locale-bundle')
    expect(fetchNetwork).not.toHaveBeenCalled()
  })

  it('caches a locale chunk on first online load for later offline use', async () => {
    fetchNetwork.mockResolvedValueOnce(new Response('fresh-bundle'))

    const first = dispatchFetch('/assets/de-DE-XyZ789.js')
    const firstResult = await Promise.allSettled([
      first.response,
      ...first.lifetime,
    ])
    if (firstResult[0]?.status === 'rejected') throw firstResult[0].reason
    expect(await (await first.response)?.text()).toBe('fresh-bundle')

    // Offline again: the stored chunk serves without the network.
    fetchNetwork.mockClear()
    const second = dispatchFetch('/assets/de-DE-XyZ789.js')
    const secondResult = await Promise.allSettled([
      second.response,
      ...second.lifetime,
    ])
    if (secondResult[0]?.status === 'rejected') throw secondResult[0].reason
    expect(await (await second.response)?.text()).toBe('fresh-bundle')
    expect(fetchNetwork).not.toHaveBeenCalled()
  })

  it('leaves non-locale chunks to the network instead of the locale cache', async () => {
    // No route claims generic app chunks: the fetch falls through to the
    // browser network (unhandled in this harness), and nothing lands in the
    // locale runtime cache.
    const { response, lifetime } = dispatchFetch('/assets/index-0fHWevXD.js')
    await Promise.allSettled([response, ...lifetime])
    expect(response).toBeUndefined()
    expect(fetchNetwork).not.toHaveBeenCalled()
    expect(runtimeEntries.size).toBe(0)
  })

  it('bounds the runtime cache so stale hashes cannot grow without limit', async () => {
    for (let i = 0; i < 50; i += 1) {
      runtimeEntries.set(
        `${origin}/assets/fr-FR-hash${i}.js`,
        new Response(`bundle-${i}`),
      )
    }
    fetchNetwork.mockResolvedValueOnce(new Response('new-bundle'))

    const { response, lifetime } = dispatchFetch('/assets/fr-FR-new.js')
    const result = await Promise.allSettled([response, ...lifetime])
    if (result[0]?.status === 'rejected') throw result[0].reason
    expect(await (await response)?.text()).toBe('new-bundle')
    expect(runtimeEntries.size).toBeLessThanOrEqual(48)
  })
})

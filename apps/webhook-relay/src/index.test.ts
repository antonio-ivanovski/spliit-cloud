import { createHash, createHmac } from 'node:crypto'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import relay, { handleRelayRequest } from './index'

const SECRET = 'r'.repeat(32)

function relayHeaders(args: {
  destination: string
  body: string
  requestId: string
  secret: string
  expires: number
}): Record<string, string> {
  const bodyHash = createHash('sha256').update(args.body, 'utf8').digest('hex')
  const signed = [
    '1',
    args.destination,
    String(args.expires),
    args.requestId,
    bodyHash,
  ].join('\n')
  const signature = createHmac('sha256', args.secret)
    .update(signed, 'utf8')
    .digest('base64url')
  return {
    'x-spliit-relay-version': '1',
    'x-spliit-relay-destination': Buffer.from(
      args.destination,
      'utf8',
    ).toString('base64url'),
    'x-spliit-relay-expires': String(args.expires),
    'x-spliit-relay-request-id': args.requestId,
    'x-spliit-relay-signature': `v1,${signature}`,
  }
}

function relayRequest(args: {
  path?: string
  method?: string
  headers: Record<string, string>
  body?: string
}): Request {
  return new Request(`https://relay.test${args.path ?? '/forward'}`, {
    method: args.method ?? 'POST',
    headers: args.headers,
    body: args.body,
  })
}

async function errorCode(response: Response): Promise<unknown> {
  const payload = (await response.json()) as { error?: unknown }
  return payload.error
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('request gating', () => {
  it('rejects non-POST requests', async () => {
    const response = await handleRelayRequest(
      relayRequest({ method: 'GET', headers: {} }),
      SECRET,
    )
    expect(response.status).toBe(502)
    expect(await errorCode(response)).toBe('invalid_method')
  })

  it('rejects paths other than /forward', async () => {
    const response = await handleRelayRequest(
      relayRequest({ path: '/', headers: {}, body: '' }),
      SECRET,
    )
    expect(response.status).toBe(502)
    expect(await errorCode(response)).toBe('invalid_path')
  })

  it('rejects requests without an envelope', async () => {
    const response = await handleRelayRequest(
      relayRequest({ headers: {}, body: '{}' }),
      SECRET,
    )
    expect(response.status).toBe(502)
    expect(await errorCode(response)).toBe('missing_envelope')
  })

  it('requires a configured relay secret', async () => {
    const response = await relay.fetch(
      relayRequest({ headers: {}, body: '{}' }),
      {},
    )
    expect(response.status).toBe(502)
    expect(await errorCode(response)).toBe('misconfigured')
  })
})

describe('envelope verification and forwarding', () => {
  it('forwards the unchanged body with allowlisted headers', async () => {
    const destination = 'https://example.com/hook'
    const body = '{"hello":"world"}'
    const headers = {
      ...relayHeaders({
        destination,
        body,
        requestId: 'attempt-123',
        secret: SECRET,
        expires: Math.floor(Date.now() / 1000) + 60,
      }),
      'content-type': 'application/json',
      'user-agent': 'Spliit-Webhooks/1.0',
      'webhook-id': 'evt_1',
      'webhook-timestamp': '1758280000',
      'webhook-signature': 'v1,abc',
      'x-evil': 'drop',
    }
    const calls: Array<{ url: string; init: RequestInit }> = []
    vi.stubGlobal(
      'fetch',
      async (input: string | URL | Request, init?: RequestInit) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url
        calls.push({ url, init: init ?? {} })
        return new Response(null, { status: 202 })
      },
    )

    const response = await handleRelayRequest(
      relayRequest({ headers, body }),
      SECRET,
    )

    expect(response.status).toBe(202)
    expect(await response.text()).toBe('')
    expect(calls).toHaveLength(1)
    const call = calls[0]
    expect(call?.url).toBe(destination)
    const sentBody = call?.init.body
    expect(sentBody instanceof ArrayBuffer).toBe(true)
    if (sentBody instanceof ArrayBuffer) {
      expect(new TextDecoder().decode(sentBody)).toBe(body)
    }
    const sentHeaders = call?.init.headers
    expect(sentHeaders instanceof Headers).toBe(true)
    if (sentHeaders instanceof Headers) {
      expect(sentHeaders.get('content-type')).toContain('application/json')
      expect(sentHeaders.get('webhook-id')).toBe('evt_1')
      expect(sentHeaders.get('webhook-timestamp')).toBe('1758280000')
      expect(sentHeaders.get('webhook-signature')).toBe('v1,abc')
      expect(sentHeaders.get('x-spliit-relay-destination')).toBeNull()
      expect(sentHeaders.get('x-evil')).toBeNull()
    }
  })

  it('accepts a slightly expired envelope within the skew grace', async () => {
    const destination = 'https://example.com/hook'
    const body = '{}'
    const headers = relayHeaders({
      destination,
      body,
      requestId: 'attempt-skew',
      secret: SECRET,
      expires: Math.floor(Date.now() / 1000) - 10,
    })
    vi.stubGlobal('fetch', async () => new Response(null, { status: 200 }))

    const response = await handleRelayRequest(
      relayRequest({ headers, body }),
      SECRET,
    )

    expect(response.status).toBe(200)
  })

  it('rejects an envelope past the skew grace', async () => {
    const headers = relayHeaders({
      destination: 'https://example.com/hook',
      body: '{}',
      requestId: 'attempt-old',
      secret: SECRET,
      expires: Math.floor(Date.now() / 1000) - 90,
    })
    const fetchSpy = vi.fn(async () => new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchSpy)

    const response = await handleRelayRequest(
      relayRequest({ headers, body: '{}' }),
      SECRET,
    )

    expect(response.status).toBe(502)
    expect(await errorCode(response)).toBe('expired_envelope')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('rejects a tampered body', async () => {
    const headers = relayHeaders({
      destination: 'https://example.com/hook',
      body: '{"hello":"world"}',
      requestId: 'attempt-tamper',
      secret: SECRET,
      expires: Math.floor(Date.now() / 1000) + 60,
    })

    const response = await handleRelayRequest(
      relayRequest({ headers, body: '{"hello":"mars"}' }),
      SECRET,
    )

    expect(response.status).toBe(502)
    expect(await errorCode(response)).toBe('invalid_signature')
  })

  it.each([
    ['http destination', 'http://example.com/hook'],
    ['credentials', 'https://user:pass@example.com/hook'],
    ['ipv4 literal', 'https://127.0.0.1/hook'],
    ['ipv6 literal', 'https://[::1]/hook'],
    ['fragment', 'https://example.com/hook#fragment'],
  ])('rejects %s', async (_label, destination) => {
    const headers = relayHeaders({
      destination,
      body: '{}',
      requestId: 'attempt-destination',
      secret: SECRET,
      expires: Math.floor(Date.now() / 1000) + 60,
    })

    const response = await handleRelayRequest(
      relayRequest({ headers, body: '{}' }),
      SECRET,
    )

    expect(response.status).toBe(502)
    expect(await errorCode(response)).toBe('invalid_destination')
  })

  it('returns an upstream error status verbatim', async () => {
    const destination = 'https://example.com/hook'
    const body = '{}'
    const headers = relayHeaders({
      destination,
      body,
      requestId: 'attempt-500',
      secret: SECRET,
      expires: Math.floor(Date.now() / 1000) + 60,
    })
    vi.stubGlobal('fetch', async () => new Response(null, { status: 500 }))

    const response = await handleRelayRequest(
      relayRequest({ headers, body }),
      SECRET,
    )

    expect(response.status).toBe(500)
    expect(await response.text()).toBe('')
    expect(console.log).toHaveBeenCalled()
  })

  it('maps an unreachable destination to a retryable relay failure', async () => {
    const destination = 'https://example.com/hook'
    const body = '{}'
    const headers = relayHeaders({
      destination,
      body,
      requestId: 'attempt-down',
      secret: SECRET,
      expires: Math.floor(Date.now() / 1000) + 60,
    })
    vi.stubGlobal('fetch', async () => {
      throw new Error('unreachable')
    })

    const response = await handleRelayRequest(
      relayRequest({ headers, body }),
      SECRET,
    )

    expect(response.status).toBe(502)
    expect(await errorCode(response)).toBe('forward_failed')
  })
})

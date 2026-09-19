import { createHash, createHmac } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { describe, expect, it } from 'vitest'

import { classifyWebhookResponse } from './delivery'
import {
  buildRelayEnvelope,
  canonicalizeRelayDestination,
  sendWebhookRelayRequest,
  WEBHOOK_RELAY_EXPIRY_SECONDS,
} from './security'

describe('relay destination canonicalization', () => {
  it.each([
    ['https://EXAMPLE.com/hook', 'https://example.com/hook'],
    ['https://example.com:443/hook', 'https://example.com/hook'],
    ['https://example.com/hook#fragment', 'https://example.com/hook'],
    ['https://example.com:8443/hook', 'https://example.com:8443/hook'],
    ['https://example.com/hook?a=1&b=2', 'https://example.com/hook?a=1&b=2'],
  ])('canonicalizes %s to %s', (input, expected) => {
    expect(canonicalizeRelayDestination(input)).toBe(expected)
  })

  it.each([
    'http://example.com/hook',
    'https://user:password@example.com/hook',
    'not-a-url',
  ])('rejects %s', (input) => {
    expect(() => canonicalizeRelayDestination(input)).toThrow()
  })
})

describe('relay envelope', () => {
  const args = {
    destination: 'https://example.com/hook',
    body: '{"hello":"world"}',
    requestId: 'attempt-123',
    secret: 'r'.repeat(32),
    now: new Date('2026-09-18T12:34:56.000Z'),
  }

  it('signs version, destination, expiry, request ID, and body hash', () => {
    const envelope = buildRelayEnvelope(args)
    const expires = Math.floor(args.now.getTime() / 1000)
    expect(envelope.expires).toBe(expires + WEBHOOK_RELAY_EXPIRY_SECONDS)

    const bodyHash = createHash('sha256')
      .update(args.body, 'utf8')
      .digest('hex')
    const expected = createHmac('sha256', args.secret)
      .update(
        [
          '1',
          args.destination,
          String(envelope.expires),
          args.requestId,
          bodyHash,
        ].join('\n'),
        'utf8',
      )
      .digest('base64url')

    expect(envelope.headers).toMatchObject({
      'x-spliit-relay-version': '1',
      'x-spliit-relay-destination': Buffer.from(
        args.destination,
        'utf8',
      ).toString('base64url'),
      'x-spliit-relay-expires': String(envelope.expires),
      'x-spliit-relay-request-id': args.requestId,
      'x-spliit-relay-signature': `v1,${expected}`,
    })
  })

  it('round-trips the destination through base64url', () => {
    const { headers } = buildRelayEnvelope(args)
    const decoded = Buffer.from(
      headers['x-spliit-relay-destination']!,
      'base64url',
    ).toString('utf8')
    expect(decoded).toBe(args.destination)
  })

  it('expires exactly WEBHOOK_RELAY_EXPIRY_SECONDS after now', () => {
    expect(WEBHOOK_RELAY_EXPIRY_SECONDS).toBe(60)
  })
})

describe('relay request transport', () => {
  it('POSTs the unchanged body with merged headers and returns the status', async () => {
    const seen: {
      method?: string
      headers: Record<string, string>
      body: string
    } = {
      headers: {},
      body: '',
    }
    const server = createServer((req, res) => {
      seen.method = req.method
      seen.headers = { ...(req.headers as Record<string, string>) }
      let body = ''
      req.on('data', (chunk) => {
        body += chunk
      })
      req.on('end', () => {
        seen.body = body
        res.writeHead(429)
        res.end()
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const { port } = server.address() as AddressInfo
      const status = await sendWebhookRelayRequest({
        relayUrl: `http://127.0.0.1:${port}/forward`,
        headers: {
          'content-type': 'application/json',
          'webhook-id': 'evt_test',
          'x-spliit-relay-version': '1',
        },
        body: '{"hello":"world"}',
      })
      expect(status).toBe(429)
      expect(seen.method).toBe('POST')
      expect(seen.body).toBe('{"hello":"world"}')
      expect(seen.headers['webhook-id']).toBe('evt_test')
      expect(seen.headers['x-spliit-relay-version']).toBe('1')
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
    }
  })

  it('rejects an invalid relay URL', async () => {
    await expect(
      sendWebhookRelayRequest({
        relayUrl: 'not-a-url',
        headers: {},
        body: '{}',
      }),
    ).rejects.toThrow(/relay URL is invalid/)
  })
})

describe('relay response classification', () => {
  it('treats a relay-side 502 as transient so deliveries retry', () => {
    expect(classifyWebhookResponse(502)).toMatchObject({ transient: true })
  })
})

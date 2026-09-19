import { createHmac } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  webhookEventFilterSchema,
  webhookOperationMatchesFilter,
} from '@spliit/domain/webhooks'

import { env } from '../env'
import { classifyWebhookResponse } from './delivery'
import {
  buildPinnedWebhookRequest,
  displayWebhookSecret,
  isTransientDnsError,
  resolveWebhookTarget,
  sendWebhookRequest,
  standardWebhookHeaders,
  validateWebhookUrl,
} from './security'

const originalSecret = env.BETTER_AUTH_SECRET

beforeAll(() => {
  env.BETTER_AUTH_SECRET = 'webhook-test-secret'
})

afterAll(() => {
  env.BETTER_AUTH_SECRET = originalSecret
})

describe('webhook signing', () => {
  it('uses the displayed whsec secret with the Standard Webhooks input', () => {
    const body = '{"hello":"world"}'
    const eventId = 'evt_test'
    const now = new Date('2026-09-18T12:34:56.000Z')
    const secret = displayWebhookSecret('endpoint-1', 1)
    const headers = standardWebhookHeaders({
      endpointId: 'endpoint-1',
      secretVersion: 1,
      eventId,
      body,
      now,
    })
    const timestamp = Math.floor(now.getTime() / 1000)
    const expected = createHmac(
      'sha256',
      Buffer.from(secret.slice('whsec_'.length), 'base64'),
    )
      .update(`${eventId}.${timestamp}.${body}`)
      .digest('base64')

    expect(headers).toMatchObject({
      'webhook-id': eventId,
      'webhook-timestamp': String(timestamp),
      'webhook-signature': `v1,${expected}`,
    })
  })
})

describe('webhook URL policy', () => {
  it.each([
    'http://example.com/hook',
    'https://127.0.0.1/hook',
    'https://10.1.2.3/hook',
    'https://[::1]/hook',
    'https://user:password@example.com/hook',
  ])('rejects unsafe endpoint %s', async (url) => {
    await expect(validateWebhookUrl(url)).rejects.toThrow()
  })

  it('accepts a public HTTPS literal address', async () => {
    await expect(validateWebhookUrl('https://1.1.1.1/hook')).resolves.toEqual(
      new URL('https://1.1.1.1/hook'),
    )
  })

  it('rejects IP literals when the relay is configured', async () => {
    env.WEBHOOK_RELAY_URL = 'https://relay.example.com/forward'
    env.WEBHOOK_RELAY_SECRET = 'x'.repeat(32)
    try {
      await expect(validateWebhookUrl('https://1.1.1.1/hook')).rejects.toThrow(
        /IP literal/,
      )
      await expect(
        validateWebhookUrl('https://[2606:4700:4700::1111]/hook'),
      ).rejects.toThrow(/IP literal/)
    } finally {
      env.WEBHOOK_RELAY_URL = undefined
      env.WEBHOOK_RELAY_SECRET = undefined
    }
  })
})

describe('webhook response classification', () => {
  it.each([200, 201, 204, 299])('accepts HTTP %s', (status) => {
    expect(classifyWebhookResponse(status)).toBeNull()
  })

  it.each([408, 409, 425, 429, 500, 503])('retries HTTP %s', (status) => {
    expect(classifyWebhookResponse(status)).toMatchObject({ transient: true })
  })

  it.each([300, 301, 400, 401, 404, 422])(
    'fails HTTP %s permanently',
    (status) => {
      expect(classifyWebhookResponse(status)).toMatchObject({
        transient: false,
      })
    },
  )
})

describe('webhook DNS retry classification', () => {
  it.each(['EAI_AGAIN', 'ETIMEDOUT', 'EAI_FAIL'])(
    'treats %s as transient',
    (code) => {
      const error = new Error(`getaddrinfo ${code}`)
      ;(error as NodeJS.ErrnoException).code = code
      expect(isTransientDnsError(error)).toBe(true)
    },
  )

  it.each(['ENOTFOUND', 'ERR_INVALID_URL'])(
    'treats %s as permanent',
    (code) => {
      const error = new Error(code)
      ;(error as NodeJS.ErrnoException).code = code
      expect(isTransientDnsError(error)).toBe(false)
    },
  )
})

describe('webhook event filter', () => {
  it('requires at least one event type', () => {
    expect(
      webhookEventFilterSchema.safeParse({
        created: false,
        updated: false,
        deleted: false,
        involvedOnly: false,
      }).success,
    ).toBe(false)
    expect(
      webhookEventFilterSchema.safeParse({
        created: true,
        updated: false,
        deleted: false,
        involvedOnly: true,
      }).success,
    ).toBe(true)
  })

  it('matches operations against the filter', () => {
    expect(
      webhookOperationMatchesFilter('created', {
        created: true,
        updated: false,
        deleted: false,
        involvedOnly: false,
      }),
    ).toBe(true)
    expect(
      webhookOperationMatchesFilter('updated', {
        created: true,
        updated: false,
        deleted: false,
        involvedOnly: false,
      }),
    ).toBe(false)
  })
})

describe('webhook request pinning', () => {
  it('rewrites the URL to the literal IP while preserving host and SNI', () => {
    const pinned = buildPinnedWebhookRequest(
      new URL('https://webhook.site/abc?x=1'),
      '178.63.67.106',
    )
    expect(pinned.url.href).toBe('https://178.63.67.106/abc?x=1')
    expect(pinned.host).toBe('webhook.site')
    expect(pinned.servername).toBe('webhook.site')
  })

  it('brackets IPv6 literals and preserves explicit ports', () => {
    const pinned = buildPinnedWebhookRequest(
      new URL('https://example.com:8443/hook'),
      '2a01:4f8:1c1c:6b00::1',
    )
    expect(pinned.url.href).toBe('https://[2a01:4f8:1c1c:6b00::1]:8443/hook')
    expect(pinned.host).toBe('example.com:8443')
    expect(pinned.servername).toBe('example.com')
  })

  it('omits the SNI override for IP-literal endpoints', () => {
    const pinned = buildPinnedWebhookRequest(
      new URL('https://1.1.1.1/hook'),
      '1.1.1.1',
    )
    expect(pinned.url.href).toBe('https://1.1.1.1/hook')
    expect(pinned.host).toBe('1.1.1.1')
    expect(pinned.servername).toBeUndefined()
  })

  it('delivers through the pinned address with the original Host header', async () => {
    const seen: Array<string | undefined> = []
    const server = createServer((_req, res) => {
      seen.push(_req.headers.host)
      res.writeHead(200)
      res.end('ok')
    })
    await new Promise<void>((resolve) => server.listen(0, resolve))
    try {
      const port = (server.address() as AddressInfo).port
      const previous = env.WEBHOOK_ALLOW_PRIVATE_ENDPOINTS
      env.WEBHOOK_ALLOW_PRIVATE_ENDPOINTS = true
      try {
        const target = await resolveWebhookTarget(
          `http://localhost:${port}/hook`,
        )
        const status = await sendWebhookRequest({
          target,
          headers: {},
          body: '{}',
        })
        expect(status).toBe(200)
        expect(seen).toContain(`localhost:${port}`)
      } finally {
        env.WEBHOOK_ALLOW_PRIVATE_ENDPOINTS = previous
      }
    } finally {
      // Fire-and-forget teardown: awaiting server.close() hangs under Bun.
      server.closeAllConnections()
      server.unref()
      server.close()
    }
  })
})

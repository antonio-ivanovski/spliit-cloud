import { mocked } from 'nodemailer-mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Patch `nodemailer` with `nodemailer-mock` so real senders run against an
// in-process mock transport. We deliberately do NOT import `../test/mocks`
// here: that file would `vi.mock('../lib/mail/send', ...)` and short-circuit
// the module under test.
//
// Every test constructs its own sender via `createEmailSender` with explicit
// config, so no env stubbing or `vi.resetModules()` reloads are needed — the
// transporter cache lives per-sender instance.
vi.mock('nodemailer', async () => await import('nodemailer-mock'))

import { createCloudflareEmailSender, createEmailSender } from './send'

beforeEach(() => {
  // Clear mock state (sent mail cache, shouldFail flag, transporters) so
  // each test sees a clean slate.
  mocked.mock.reset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('sendEmail', () => {
  it('throws when no transport is configured', async () => {
    const send = createEmailSender({})

    await expect(
      send({
        to: 'dev@example.com',
        subject: 's',
        text: 't',
        html: '<p>t</p>',
      }),
    ).rejects.toThrow(/No email transport is configured/)
  })

  it('sends through SMTP with full from/to/subject/text/html fields', async () => {
    const send = createEmailSender({
      host: 'smtp.test',
      port: 587,
      user: 'user',
      pass: 'pass',
      from: 'Spliit <noreply@test>',
    })

    await send({
      to: 'recipient@example.com',
      subject: 'Test subject',
      text: 'plain text body',
      html: '<p>html body</p>',
    })

    const sent = mocked.mock.getSentMail()
    expect(sent).toHaveLength(1)
    expect(sent[0].from).toBe('Spliit <noreply@test>')
    expect(sent[0].to).toBe('recipient@example.com')
    expect(sent[0].subject).toBe('Test subject')
    expect(sent[0].text).toBe('plain text body')
    expect(sent[0].html).toBe('<p>html body</p>')
  })

  it.each([
    { text: '', html: '<p>html body</p>' },
    { text: 'plain text body', html: '' },
    { text: '   ', html: '<p>html body</p>' },
    { text: 'plain text body', html: '   ' },
  ])('rejects empty email bodies', async ({ text, html }) => {
    const send = createEmailSender({ host: 'smtp.test' })

    await expect(
      send({
        to: 'recipient@example.com',
        subject: 'Test subject',
        text,
        html,
      }),
    ).rejects.toThrow(/Email text and html must be non-empty/)
  })

  it('uses EMAIL_FROM as the from address on every send', async () => {
    const send = createEmailSender({
      host: 'smtp.test',
      port: 587,
      user: 'user',
      pass: 'pass',
      from: 'Custom From <custom@test>',
    })

    await send({
      to: 'a@example.com',
      subject: 's1',
      text: 'b1',
      html: '<p>b1</p>',
    })
    await send({
      to: 'b@example.com',
      subject: 's2',
      text: 'b2',
      html: '<p>b2</p>',
    })

    const sent = mocked.mock.getSentMail()
    expect(sent).toHaveLength(2)
    expect(sent.map((m) => m.from)).toEqual([
      'Custom From <custom@test>',
      'Custom From <custom@test>',
    ])
  })

  describe('port mapping', () => {
    const cases = [
      { port: 465, secure: true, requireTLS: false },
      { port: 587, secure: false, requireTLS: true },
      { port: 25, secure: false, requireTLS: false },
    ]
    for (const { port, secure, requireTLS } of cases) {
      it(`SMTP_PORT=${port} -> secure=${secure}, requireTLS=${requireTLS}`, async () => {
        const createTransportSpy = vi.spyOn(mocked, 'createTransport')
        const send = createEmailSender({
          host: 'smtp.test',
          port,
          user: 'user',
          pass: 'pass',
          from: 'Spliit <noreply@test>',
        })

        await send({
          to: 'r@example.com',
          subject: 's',
          text: 't',
          html: '<p>t</p>',
        })

        expect(createTransportSpy).toHaveBeenCalledTimes(1)
        const opts = createTransportSpy.mock.calls[0][0] as Record<
          string,
          unknown
        >
        expect(opts).toMatchObject({
          host: 'smtp.test',
          port,
          secure,
          requireTLS,
        })
      })
    }
  })

  it('caches the transporter across multiple sendEmail calls', async () => {
    const createTransportSpy = vi.spyOn(mocked, 'createTransport')
    const send = createEmailSender({
      host: 'smtp.test',
      port: 587,
      user: 'user',
      pass: 'pass',
      from: 'Spliit <noreply@test>',
    })

    await send({
      to: 'a@example.com',
      subject: 's1',
      text: 't1',
      html: '<p>t1</p>',
    })
    await send({
      to: 'b@example.com',
      subject: 's2',
      text: 't2',
      html: '<p>t2</p>',
    })

    expect(createTransportSpy).toHaveBeenCalledTimes(1)
  })

  it('propagates errors from the SMTP send', async () => {
    const send = createEmailSender({ host: 'smtp.test' })
    mocked.mock.setShouldFail(true)
    try {
      await expect(
        send({
          to: 'r@example.com',
          subject: 's',
          text: 't',
          html: '<p>t</p>',
        }),
      ).rejects.toThrow(/nodemailer-mock failure/i)
    } finally {
      mocked.mock.setShouldFail(false)
    }
  })
})

describe('createCloudflareEmailSender', () => {
  const baseConfig = {
    accountId: 'acct-123',
    apiToken: 'cf-token',
    from: 'Spliit Cloud <noreply@test>',
  }

  const message = {
    to: 'recipient@example.com',
    subject: 'Test subject',
    text: 'plain text body',
    html: '<p>html body</p>',
  }

  function okFetch(): typeof fetch {
    return (async () =>
      new Response(JSON.stringify({ success: true }), {
        status: 200,
      })) as typeof fetch
  }

  it('throws when the account ID or token is missing', async () => {
    for (const config of [
      {},
      { accountId: 'acct-123' },
      { apiToken: 'cf-token' },
    ]) {
      const send = createCloudflareEmailSender(config)
      await expect(send(message)).rejects.toThrow(
        /CF_EMAIL_ACCOUNT_ID\/CF_EMAIL_API_TOKEN/,
      )
    }
  })

  it('throws when EMAIL_FROM is missing', async () => {
    const send = createCloudflareEmailSender({
      ...baseConfig,
      from: undefined,
      fetchImpl: okFetch(),
    })
    await expect(send(message)).rejects.toThrow(/EMAIL_FROM is not configured/)
  })

  it.each([
    { text: '', html: '<p>html body</p>' },
    { text: 'plain text body', html: '' },
  ])('rejects empty email bodies', async ({ text, html }) => {
    const send = createCloudflareEmailSender({
      ...baseConfig,
      fetchImpl: okFetch(),
    })
    await expect(send({ ...message, text, html })).rejects.toThrow(
      /Email text and html must be non-empty/,
    )
  })

  it('posts from/to/subject/text/html/headers to the account send endpoint', async () => {
    const calls: Array<{ url: unknown; init: RequestInit }> = []
    const fetchImpl = (async (url: unknown, init: RequestInit) => {
      calls.push({ url, init })
      return new Response(JSON.stringify({ success: true }), { status: 200 })
    }) as typeof fetch
    const send = createCloudflareEmailSender({
      ...baseConfig,
      fetchImpl,
    })

    await send({
      ...message,
      headers: { 'List-Unsubscribe': '<https://example.com/unsub>' },
    })

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(
      'https://api.cloudflare.com/client/v4/accounts/acct-123/email/sending/send',
    )
    const init = calls[0].init
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer cf-token',
      'Content-Type': 'application/json',
    })
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(JSON.parse(init.body as string)).toEqual({
      from: 'Spliit Cloud <noreply@test>',
      to: ['recipient@example.com'],
      subject: 'Test subject',
      text: 'plain text body',
      html: '<p>html body</p>',
      headers: { 'List-Unsubscribe': '<https://example.com/unsub>' },
    })
  })

  it('omits the headers key when the message has none', async () => {
    let body: Record<string, unknown> = {}
    const fetchImpl = (async (_url: unknown, init: RequestInit) => {
      body = JSON.parse(init.body as string) as Record<string, unknown>
      return new Response(JSON.stringify({ success: true }), { status: 200 })
    }) as typeof fetch
    await createCloudflareEmailSender({ ...baseConfig, fetchImpl })(message)
    expect(body).not.toHaveProperty('headers')
  })

  it('surfaces Cloudflare API errors with status and provider code', async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          success: false,
          errors: [{ code: 6103, message: 'Invalid credentials' }],
        }),
        { status: 403 },
      )) as typeof fetch
    const send = createCloudflareEmailSender({ ...baseConfig, fetchImpl })

    const error = await send(message).catch((err: unknown) => err)
    expect(error).toBeInstanceOf(Error)
    expect(error).toMatchObject({
      code: 'CF_HTTP_403',
      responseCode: 403,
      provider: 'cloudflare-email',
    })
    expect((error as Error).message).toContain('6103')
    expect((error as Error).message).toContain('Invalid credentials')
  })

  it('handles non-JSON error bodies without throwing a parse error', async () => {
    const fetchImpl = (async () =>
      new Response('Bad Gateway', { status: 502 })) as typeof fetch
    const error = await createCloudflareEmailSender({
      ...baseConfig,
      fetchImpl,
    })(message).catch((err: unknown) => err)
    expect(error).toMatchObject({
      code: 'CF_HTTP_502',
      responseCode: 502,
    })
  })

  it('maps network failures to a retryable code', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('fetch failed')
    }) as typeof fetch
    const error = await createCloudflareEmailSender({
      ...baseConfig,
      fetchImpl,
    })(message).catch((err: unknown) => err)
    expect(error).toMatchObject({ code: 'CF_NETWORK' })
  })

  it('maps aborts to a timeout code', async () => {
    const fetchImpl = (async () => {
      throw new DOMException('The operation timed out', 'TimeoutError')
    }) as typeof fetch
    const error = await createCloudflareEmailSender({
      ...baseConfig,
      fetchImpl,
    })(message).catch((err: unknown) => err)
    expect(error).toMatchObject({ code: 'CF_TIMEOUT' })
  })
})

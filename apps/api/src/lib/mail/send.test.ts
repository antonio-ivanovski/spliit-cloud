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

import { createEmailSender } from './send'

beforeEach(() => {
  // Clear mock state (sent mail cache, shouldFail flag, transporters) so
  // each test sees a clean slate.
  mocked.mock.reset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('sendEmail', () => {
  it('throws when SMTP_HOST is unset', async () => {
    const send = createEmailSender({})

    await expect(
      send({
        to: 'dev@example.com',
        subject: 's',
        text: 't',
        html: '<p>t</p>',
      }),
    ).rejects.toThrow(/SMTP_HOST is not configured/)
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

import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Patch `nodemailer` with `nodemailer-mock` so the real `sendEmail` runs
// against an in-process mock transport. We deliberately do NOT import
// `../test/mocks` here: that file would `vi.mock('../lib/mail/send', ...)`
// and short-circuit the module under test.
//
// `vi.mock` is hoisted to the top of the file. The factory only runs the
// first time something imports `nodemailer` after a `vi.resetModules()`,
// which is exactly when each test imports `../mail/send`.
vi.mock('nodemailer', async () => await import('nodemailer-mock'))

const originalCwd = process.cwd()
let tempDir: string | undefined

beforeEach(async () => {
  // Isolate the .mail/ fallback directory per test. Without this, the
  // local-dev test would write into the real repo's .mail/ folder.
  tempDir = mkdtempSync(join(tmpdir(), 'spliit-mail-'))
  process.chdir(tempDir)
  // Clear mock state (sent mail cache, shouldFail flag, transporters) so
  // each test sees a clean slate even when vi.resetModules is not called.
  const mock = (await import('nodemailer-mock')).mocked
  mock.mock.reset()
})

afterEach(() => {
  process.chdir(originalCwd)
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true })
    tempDir = undefined
  }
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('sendEmail', () => {
  it('writes a .eml file to <cwd>/.mail/ when SMTP_HOST is unset (local-dev fallback)', async () => {
    // SMTP_HOST is intentionally not stubbed — it stays undefined.
    vi.resetModules()
    const { sendEmail } = await import('./send')

    await sendEmail({
      to: 'dev@example.com',
      subject: 'Hello from local dev',
      text: 'This is a local dev email.',
    })

    const mailDir = join(tempDir!, '.mail')
    const files = readdirSync(mailDir)
    expect(files).toHaveLength(1)
    expect(files[0]).toContain('dev@example.com')
    const content = readFileSync(join(mailDir, files[0]), 'utf8')
    expect(content).toContain('To: dev@example.com')
    expect(content).toContain('Subject: Hello from local dev')
    expect(content).toContain('This is a local dev email.')
  })

  it('sends through SMTP with full from/to/subject/text/html fields', async () => {
    vi.stubEnv('SMTP_HOST', 'smtp.test')
    vi.stubEnv('SMTP_PORT', '587')
    vi.stubEnv('SMTP_USER', 'user')
    vi.stubEnv('SMTP_PASS', 'pass')
    vi.stubEnv('EMAIL_FROM', 'Spliit <noreply@test>')
    vi.resetModules()

    const { sendEmail } = await import('./send')
    const mock = (await import('nodemailer-mock')).mocked

    await sendEmail({
      to: 'recipient@example.com',
      subject: 'Test subject',
      text: 'plain text body',
      html: '<p>html body</p>',
    })

    const sent = mock.mock.getSentMail()
    expect(sent).toHaveLength(1)
    expect(sent[0].from).toBe('Spliit <noreply@test>')
    expect(sent[0].to).toBe('recipient@example.com')
    expect(sent[0].subject).toBe('Test subject')
    expect(sent[0].text).toBe('plain text body')
    expect(sent[0].html).toBe('<p>html body</p>')
  })

  it('uses EMAIL_FROM as the from address on every send', async () => {
    vi.stubEnv('SMTP_HOST', 'smtp.test')
    vi.stubEnv('SMTP_PORT', '587')
    vi.stubEnv('SMTP_USER', 'user')
    vi.stubEnv('SMTP_PASS', 'pass')
    vi.stubEnv('EMAIL_FROM', 'Custom From <custom@test>')
    vi.resetModules()

    const { sendEmail } = await import('./send')
    const mock = (await import('nodemailer-mock')).mocked

    await sendEmail({ to: 'a@example.com', subject: 's1', text: 'b1' })
    await sendEmail({ to: 'b@example.com', subject: 's2', text: 'b2' })

    const sent = mock.mock.getSentMail()
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
        vi.stubEnv('SMTP_HOST', 'smtp.test')
        vi.stubEnv('SMTP_PORT', String(port))
        vi.stubEnv('SMTP_USER', 'user')
        vi.stubEnv('SMTP_PASS', 'pass')
        vi.stubEnv('EMAIL_FROM', 'Spliit <noreply@test>')
        vi.resetModules()

        // `send.ts` does `import nodemailer from 'nodemailer'`, which lands
        // on the `mocked` instance's default export. To intercept that call
        // we must spy on the `mocked` instance itself, not on the namespace
        // object returned by `await import('nodemailer')`.
        const mocked = (await import('nodemailer-mock')).mocked
        const createTransportSpy = vi.spyOn(mocked, 'createTransport')
        const { sendEmail } = await import('./send')

        await sendEmail({ to: 'r@example.com', subject: 's', text: 't' })

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
    vi.stubEnv('SMTP_HOST', 'smtp.test')
    vi.stubEnv('SMTP_PORT', '587')
    vi.stubEnv('SMTP_USER', 'user')
    vi.stubEnv('SMTP_PASS', 'pass')
    vi.stubEnv('EMAIL_FROM', 'Spliit <noreply@test>')
    vi.resetModules()

    const mocked = (await import('nodemailer-mock')).mocked
    const createTransportSpy = vi.spyOn(mocked, 'createTransport')
    const { sendEmail } = await import('./send')

    await sendEmail({ to: 'a@example.com', subject: 's1', text: 't1' })
    await sendEmail({ to: 'b@example.com', subject: 's2', text: 't2' })

    expect(createTransportSpy).toHaveBeenCalledTimes(1)
  })

  it('propagates errors from the SMTP send', async () => {
    vi.stubEnv('SMTP_HOST', 'smtp.test')
    vi.stubEnv('SMTP_PORT', '587')
    vi.stubEnv('SMTP_USER', 'user')
    vi.stubEnv('SMTP_PASS', 'pass')
    vi.stubEnv('EMAIL_FROM', 'Spliit <noreply@test>')
    vi.resetModules()

    const { sendEmail } = await import('./send')
    const mock = (await import('nodemailer-mock')).mocked
    mock.mock.setShouldFail(true)
    try {
      await expect(
        sendEmail({ to: 'r@example.com', subject: 's', text: 't' }),
      ).rejects.toThrow(/nodemailer-mock failure/i)
    } finally {
      mock.mock.setShouldFail(false)
    }
  })

  it('throws at import time when EMAIL_FROM is empty in the SMTP path (production)', async () => {
    // The env schema's superRefine only enforces SMTP/email_from when
    // NODE_ENV === 'production'. Stubbing all three gives us the production
    // validation path; an empty EMAIL_FROM is then caught at module load
    // (send.ts -> env.ts).
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret')
    vi.stubEnv('SMTP_HOST', 'smtp.test')
    vi.stubEnv('EMAIL_FROM', '')
    vi.resetModules()

    await expect(import('./send')).rejects.toThrow(
      /EMAIL_FROM is required in production/,
    )
  })
})

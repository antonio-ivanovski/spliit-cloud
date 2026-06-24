import { afterEach, describe, expect, it, vi } from 'vitest'

// Standalone env-schema tests. We deliberately do not import `../test/mocks`
// here — that file would pull in prisma, better-auth, and the mail module,
// which would also evaluate `env.ts` against whatever env happens to be
// present. Instead each case stubs its own env and dynamically imports
// `./env` to re-parse with the new values.

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('envSchema — production', () => {
  it('throws when SMTP_HOST is missing', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret')
    // SMTP_HOST intentionally not stubbed.
    vi.resetModules()
    await expect(import('./env')).rejects.toThrow(
      /SMTP_HOST is required in production/,
    )
  })

  it('throws when EMAIL_FROM is missing', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret')
    vi.stubEnv('SMTP_HOST', 'smtp.test')
    vi.stubEnv('SMTP_USER', 'user')
    vi.stubEnv('SMTP_PASS', 'pass')
    // EMAIL_FROM intentionally not stubbed.
    vi.resetModules()
    await expect(import('./env')).rejects.toThrow(
      /EMAIL_FROM is required in production/,
    )
  })

  it('throws when SMTP_USER/SMTP_PASS are missing while SMTP_HOST is set', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret')
    vi.stubEnv('SMTP_HOST', 'smtp.test')
    vi.stubEnv('EMAIL_FROM', 'Spliit <noreply@test>')
    // SMTP_USER and SMTP_PASS intentionally not stubbed.
    vi.resetModules()
    await expect(import('./env')).rejects.toThrow(
      /SMTP_USER and SMTP_PASS are required in production when SMTP_HOST is set/,
    )
  })

  it('parses successfully when all required production vars are set', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret')
    vi.stubEnv('SMTP_HOST', 'smtp.test')
    vi.stubEnv('SMTP_PORT', '587')
    vi.stubEnv('SMTP_USER', 'user')
    vi.stubEnv('SMTP_PASS', 'pass')
    vi.stubEnv('EMAIL_FROM', 'Spliit <noreply@test>')
    vi.resetModules()
    const { env } = await import('./env')
    expect(env.SMTP_HOST).toBe('smtp.test')
    expect(env.EMAIL_FROM).toBe('Spliit <noreply@test>')
    expect(env.SMTP_PORT).toBe(587)
  })
})

describe('envSchema — development', () => {
  it('allows all SMTP vars to be missing', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.resetModules()
    const { env } = await import('./env')
    expect(env.SMTP_HOST).toBeUndefined()
    expect(env.EMAIL_FROM).toBeUndefined()
    expect(env.SMTP_USER).toBeUndefined()
    expect(env.SMTP_PASS).toBeUndefined()
  })
})

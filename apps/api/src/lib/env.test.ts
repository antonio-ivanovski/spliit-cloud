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

describe('envSchema — AI / OpenAI', () => {
  it('applies default models when OPENAI_RECEIPT_MODEL and OPENAI_CATEGORY_MODEL are absent', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.resetModules()
    const { env } = await import('./env')
    expect(env.OPENAI_RECEIPT_MODEL).toBe('gpt-5-nano')
    expect(env.OPENAI_CATEGORY_MODEL).toBe('gpt-3.5-turbo')
  })

  it('parses custom OPENAI_RECEIPT_MODEL and OPENAI_CATEGORY_MODEL', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('OPENAI_RECEIPT_MODEL', 'gpt-4o')
    vi.stubEnv('OPENAI_CATEGORY_MODEL', 'gpt-4o-mini')
    vi.resetModules()
    const { env } = await import('./env')
    expect(env.OPENAI_RECEIPT_MODEL).toBe('gpt-4o')
    expect(env.OPENAI_CATEGORY_MODEL).toBe('gpt-4o-mini')
  })

  it('parses a valid OPENAI_BASE_URL', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('OPENAI_BASE_URL', 'https://openrouter.ai/api/v1')
    vi.resetModules()
    const { env } = await import('./env')
    expect(env.OPENAI_BASE_URL).toBe('https://openrouter.ai/api/v1')
  })

  it('allows OPENAI_BASE_URL to be absent', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.resetModules()
    const { env } = await import('./env')
    expect(env.OPENAI_BASE_URL).toBeUndefined()
  })

  it('throws when OPENAI_BASE_URL is an invalid URL', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('OPENAI_BASE_URL', 'not-a-url')
    vi.resetModules()
    await expect(import('./env')).rejects.toThrow()
  })

  it('throws when PUBLIC_ENABLE_RECEIPT_EXTRACT is true but OPENAI_API_KEY is missing', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('PUBLIC_ENABLE_RECEIPT_EXTRACT', 'true')
    // OPENAI_API_KEY intentionally not stubbed.
    vi.resetModules()
    await expect(import('./env')).rejects.toThrow(
      /OPENAI_API_KEY must be specified/,
    )
  })

  it('throws when PUBLIC_ENABLE_CATEGORY_EXTRACT is true but OPENAI_API_KEY is missing', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('PUBLIC_ENABLE_CATEGORY_EXTRACT', 'true')
    // OPENAI_API_KEY intentionally not stubbed.
    vi.resetModules()
    await expect(import('./env')).rejects.toThrow(
      /OPENAI_API_KEY must be specified/,
    )
  })

  it('parses successfully when both AI feature flags are enabled and OPENAI_API_KEY is set', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('PUBLIC_ENABLE_RECEIPT_EXTRACT', 'true')
    vi.stubEnv('PUBLIC_ENABLE_CATEGORY_EXTRACT', 'true')
    vi.stubEnv('OPENAI_API_KEY', 'sk-test-key')
    vi.resetModules()
    const { env } = await import('./env')
    expect(env.OPENAI_API_KEY).toBe('sk-test-key')
    // defaults still apply
    expect(env.OPENAI_RECEIPT_MODEL).toBe('gpt-5-nano')
    expect(env.OPENAI_CATEGORY_MODEL).toBe('gpt-3.5-turbo')
  })
})

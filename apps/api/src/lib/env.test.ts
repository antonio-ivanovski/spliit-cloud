import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Standalone env-schema tests. We deliberately do not import `../test/mocks`
// here — that file would pull in prisma, better-auth, and the mail module,
// which would also evaluate `env.ts` against whatever env happens to be
// present. Instead each case stubs its own env and dynamically imports
// `./env` to re-parse with the new values.

beforeEach(() => {
  // Most schema cases exercise the baseline deployment. The package-level
  // test environment enables MCP for assistant/auth suites, so explicitly
  // disable it here unless a case is testing MCP validation.
  vi.stubEnv('ENABLE_MCP', 'false')
  vi.stubEnv('MCP_PUBLIC_URL', '')
  vi.stubEnv('ASSISTANT_CONFIRMATION_SECRET', '')
})

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

  it('allows an anonymous SMTP relay when both credentials are absent', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret')
    vi.stubEnv('SMTP_HOST', 'smtp.test')
    vi.stubEnv('EMAIL_FROM', 'Spliit <noreply@test>')
    vi.stubEnv('EMAIL_UNSUBSCRIBE_SECRET', 'a'.repeat(32))
    vi.resetModules()
    const { env } = await import('./env')
    expect(env.SMTP_USER).toBeUndefined()
    expect(env.SMTP_PASS).toBeUndefined()
  })

  it('rejects partial SMTP credentials', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret')
    vi.stubEnv('SMTP_HOST', 'smtp.test')
    vi.stubEnv('SMTP_USER', 'user')
    vi.stubEnv('EMAIL_FROM', 'Spliit <noreply@test>')
    vi.stubEnv('EMAIL_UNSUBSCRIBE_SECRET', 'a'.repeat(32))
    vi.resetModules()
    await expect(import('./env')).rejects.toThrow(
      /SMTP_USER and SMTP_PASS must be configured together/,
    )
  })

  it('throws when the unsubscribe secret is too short', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret')
    vi.stubEnv('SMTP_HOST', 'smtp.test')
    vi.stubEnv('SMTP_USER', 'user')
    vi.stubEnv('SMTP_PASS', 'pass')
    vi.stubEnv('EMAIL_FROM', 'Spliit <noreply@test>')
    vi.stubEnv('EMAIL_UNSUBSCRIBE_SECRET', 'too-short')
    vi.resetModules()
    await expect(import('./env')).rejects.toThrow(
      /EMAIL_UNSUBSCRIBE_SECRET must be at least 32 bytes in production/,
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
    vi.stubEnv('PUSH_VAPID_PUBLIC_KEY', 'public-key')
    vi.stubEnv('PUSH_VAPID_PRIVATE_KEY', 'private-key')
    vi.stubEnv('PUSH_VAPID_SUBJECT', 'mailto:test@example.com')
    vi.stubEnv('EMAIL_UNSUBSCRIBE_SECRET', 'a'.repeat(32))
    vi.stubEnv('ASSISTANT_CONFIRMATION_SECRET', 'b'.repeat(32))
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

  it('normalizes empty optional URLs to undefined', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('AI_BASE_URL', '')
    vi.stubEnv('S3_UPLOAD_PUBLIC_URL', '')
    vi.stubEnv('PUSH_VAPID_SUBJECT', '')
    vi.stubEnv('MCP_PUBLIC_URL', '')
    vi.resetModules()
    const { env } = await import('./env')
    expect(env.AI_BASE_URL).toBeUndefined()
    expect(env.S3_UPLOAD_PUBLIC_URL).toBeUndefined()
    expect(env.PUSH_VAPID_SUBJECT).toBeUndefined()
    expect(env.MCP_PUBLIC_URL).toBeUndefined()
  })

  it('requires MCP secrets only when MCP is enabled', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('ENABLE_MCP', 'true')
    vi.resetModules()
    await expect(import('./env')).rejects.toThrow(
      /MCP_PUBLIC_URL is required when ENABLE_MCP is true/,
    )
  })

  it('accepts complete MCP configuration when enabled', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('ENABLE_MCP', 'true')
    vi.stubEnv('MCP_PUBLIC_URL', 'https://mcp.example.com')
    vi.stubEnv('ASSISTANT_CONFIRMATION_SECRET', 'b'.repeat(32))
    vi.resetModules()
    const { env } = await import('./env')
    expect(env.ENABLE_MCP).toBe(true)
    expect(env.MCP_PUBLIC_URL).toBe('https://mcp.example.com')
  })

  it('defaults SIGNUP_MODE to open', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.resetModules()
    const { env } = await import('./env')
    expect(env.SIGNUP_MODE).toBe('open')
  })

  it('parses invite_only SIGNUP_MODE', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('SIGNUP_MODE', 'invite_only')
    vi.resetModules()
    const { env } = await import('./env')
    expect(env.SIGNUP_MODE).toBe('invite_only')
  })

  it('rejects an invalid SIGNUP_MODE', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('SIGNUP_MODE', 'secret')
    vi.resetModules()
    await expect(import('./env')).rejects.toThrow()
  })

  it('rejects an unsupported instance currency', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('PUBLIC_DEFAULT_CURRENCY_CODE', 'ZZZ')
    vi.resetModules()
    await expect(import('./env')).rejects.toThrow(/unsupportedCurrencyCode/)
  })
})

describe('envSchema — OIDC', () => {
  it('allows all OIDC vars to be missing', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('OIDC_CLIENT_ID', '')
    vi.stubEnv('OIDC_CLIENT_SECRET', '')
    vi.stubEnv('OIDC_DISCOVERY_URL', '')
    vi.stubEnv('OIDC_DISPLAY_NAME', '')
    vi.stubEnv('OIDC_PROVIDER_ID', '')
    vi.resetModules()
    const { env, getConfiguredOidcProvider } = await import('./env')
    expect(env.OIDC_CLIENT_ID).toBeUndefined()
    expect(env.OIDC_CLIENT_SECRET).toBeUndefined()
    expect(env.OIDC_DISCOVERY_URL).toBeUndefined()
    expect(getConfiguredOidcProvider(env)).toBeUndefined()
  })

  it('rejects a partial OIDC configuration', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('OIDC_CLIENT_ID', 'oidc-client')
    vi.stubEnv('OIDC_CLIENT_SECRET', '')
    vi.stubEnv('OIDC_DISCOVERY_URL', '')
    vi.stubEnv('OIDC_DISPLAY_NAME', '')
    vi.stubEnv('OIDC_PROVIDER_ID', '')
    vi.resetModules()
    await expect(import('./env')).rejects.toThrow(
      /OIDC_CLIENT_ID, OIDC_CLIENT_SECRET and OIDC_DISCOVERY_URL must be configured together/,
    )
  })

  it('rejects a display name without credentials', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('OIDC_CLIENT_ID', '')
    vi.stubEnv('OIDC_CLIENT_SECRET', '')
    vi.stubEnv('OIDC_DISCOVERY_URL', '')
    vi.stubEnv('OIDC_DISPLAY_NAME', 'Company SSO')
    vi.stubEnv('OIDC_PROVIDER_ID', '')
    vi.resetModules()
    await expect(import('./env')).rejects.toThrow(
      /OIDC_CLIENT_ID, OIDC_CLIENT_SECRET and OIDC_DISCOVERY_URL must be configured together/,
    )
  })

  it('accepts a complete OIDC configuration and applies defaults', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('OIDC_CLIENT_ID', 'oidc-client')
    vi.stubEnv('OIDC_CLIENT_SECRET', 'oidc-secret')
    vi.stubEnv(
      'OIDC_DISCOVERY_URL',
      'https://auth.example.com/.well-known/openid-configuration',
    )
    vi.stubEnv('OIDC_DISPLAY_NAME', '')
    vi.stubEnv('OIDC_PROVIDER_ID', '')
    vi.resetModules()
    const { env, getConfiguredOidcProvider } = await import('./env')
    expect(getConfiguredOidcProvider(env)).toEqual({
      id: 'oidc',
      name: 'SSO',
      clientId: 'oidc-client',
      clientSecret: 'oidc-secret',
      discoveryUrl: 'https://auth.example.com/.well-known/openid-configuration',
    })
  })

  it('accepts custom provider id and display name', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('OIDC_CLIENT_ID', 'oidc-client')
    vi.stubEnv('OIDC_CLIENT_SECRET', 'oidc-secret')
    vi.stubEnv(
      'OIDC_DISCOVERY_URL',
      'https://auth.example.com/.well-known/openid-configuration',
    )
    vi.stubEnv('OIDC_PROVIDER_ID', 'keycloak')
    vi.stubEnv('OIDC_DISPLAY_NAME', 'Company SSO')
    vi.resetModules()
    const { env, getConfiguredOidcProvider } = await import('./env')
    expect(getConfiguredOidcProvider(env)).toEqual({
      id: 'keycloak',
      name: 'Company SSO',
      clientId: 'oidc-client',
      clientSecret: 'oidc-secret',
      discoveryUrl: 'https://auth.example.com/.well-known/openid-configuration',
    })
  })

  it('rejects an invalid OIDC_PROVIDER_ID', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('OIDC_CLIENT_ID', 'oidc-client')
    vi.stubEnv('OIDC_CLIENT_SECRET', 'oidc-secret')
    vi.stubEnv(
      'OIDC_DISCOVERY_URL',
      'https://auth.example.com/.well-known/openid-configuration',
    )
    vi.stubEnv('OIDC_PROVIDER_ID', 'not a slug')
    vi.resetModules()
    await expect(import('./env')).rejects.toThrow(
      /OIDC_PROVIDER_ID must be a URL-safe identifier/,
    )
  })
})

describe('envSchema — AI', () => {
  it('applies default provider and models when AI settings are absent', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.resetModules()
    const { env } = await import('./env')
    expect(env.AI_PROVIDER).toBe('openai')
    expect(env.AI_RECEIPT_MODEL).toBe('gpt-5-nano')
    expect(env.AI_CATEGORY_MODEL).toBe('gpt-5-nano')
    expect(env.AI_VOICE_MODEL).toBeUndefined()
  })

  it('parses custom provider and models', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('AI_PROVIDER', 'anthropic')
    vi.stubEnv('AI_RECEIPT_MODEL', 'claude-haiku-4-5')
    vi.stubEnv('AI_CATEGORY_MODEL', 'claude-sonnet-4-5')
    vi.resetModules()
    const { env } = await import('./env')
    expect(env.AI_PROVIDER).toBe('anthropic')
    expect(env.AI_RECEIPT_MODEL).toBe('claude-haiku-4-5')
    expect(env.AI_CATEGORY_MODEL).toBe('claude-sonnet-4-5')
  })

  it.each(['openai', 'anthropic', 'openai-compatible', 'google'] as const)(
    'accepts the %s provider',
    async (provider) => {
      vi.stubEnv('NODE_ENV', 'development')
      vi.stubEnv('AI_PROVIDER', provider)
      vi.resetModules()
      const { env } = await import('./env')
      expect(env.AI_PROVIDER).toBe(provider)
    },
  )

  it('applies default AI_CATEGORY_RECENT_EXPENSES_LIMIT of 50 when absent', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.resetModules()
    const { env } = await import('./env')
    expect(env.AI_CATEGORY_RECENT_EXPENSES_LIMIT).toBe(50)
  })

  it('parses a custom AI_CATEGORY_RECENT_EXPENSES_LIMIT', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('AI_CATEGORY_RECENT_EXPENSES_LIMIT', '25')
    vi.resetModules()
    const { env } = await import('./env')
    expect(env.AI_CATEGORY_RECENT_EXPENSES_LIMIT).toBe(25)
  })

  it('throws when AI_CATEGORY_RECENT_EXPENSES_LIMIT is not a positive integer', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('AI_CATEGORY_RECENT_EXPENSES_LIMIT', '0')
    vi.resetModules()
    await expect(import('./env')).rejects.toThrow()
  })

  it('applies default CATEGORY_MEMORY_LIMIT of 200 when absent', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.resetModules()
    const { env } = await import('./env')
    expect(env.CATEGORY_MEMORY_LIMIT).toBe(200)
  })

  it('parses a custom CATEGORY_MEMORY_LIMIT', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('CATEGORY_MEMORY_LIMIT', '400')
    vi.resetModules()
    const { env } = await import('./env')
    expect(env.CATEGORY_MEMORY_LIMIT).toBe(400)
  })

  it('parses a valid AI_BASE_URL', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('AI_BASE_URL', 'https://openrouter.ai/api/v1')
    vi.resetModules()
    const { env } = await import('./env')
    expect(env.AI_BASE_URL).toBe('https://openrouter.ai/api/v1')
  })

  it('allows AI_BASE_URL to be absent', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.resetModules()
    const { env } = await import('./env')
    expect(env.AI_BASE_URL).toBeUndefined()
  })

  it('throws when AI_BASE_URL is an invalid URL', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('AI_BASE_URL', 'not-a-url')
    vi.resetModules()
    await expect(import('./env')).rejects.toThrow()
  })

  it('throws when PUBLIC_ENABLE_RECEIPT_EXTRACT is true but AI_API_KEY is missing', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('PUBLIC_ENABLE_RECEIPT_EXTRACT', 'true')
    // AI_API_KEY intentionally not stubbed.
    vi.resetModules()
    await expect(import('./env')).rejects.toThrow(
      /AI_API_KEY must be specified/,
    )
  })

  it('throws when PUBLIC_ENABLE_CATEGORY_EXTRACT is true but AI_API_KEY is missing', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('PUBLIC_ENABLE_CATEGORY_EXTRACT', 'true')
    // AI_API_KEY intentionally not stubbed.
    vi.resetModules()
    await expect(import('./env')).rejects.toThrow(
      /AI_API_KEY must be specified/,
    )
  })

  it('parses successfully when both AI feature flags are enabled and AI_API_KEY is set', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('PUBLIC_ENABLE_RECEIPT_EXTRACT', 'true')
    vi.stubEnv('PUBLIC_ENABLE_CATEGORY_EXTRACT', 'true')
    vi.stubEnv('AI_API_KEY', 'sk-test-key')
    vi.resetModules()
    const { env } = await import('./env')
    expect(env.AI_API_KEY).toBe('sk-test-key')
    // defaults still apply
    expect(env.AI_RECEIPT_MODEL).toBe('gpt-5-nano')
    expect(env.AI_CATEGORY_MODEL).toBe('gpt-5-nano')
  })

  it('requires an AI key when voice extraction is enabled', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('PUBLIC_ENABLE_VOICE_EXPENSE', 'true')
    vi.resetModules()
    await expect(import('./env')).rejects.toThrow(
      /AI_API_KEY must be specified/,
    )
  })

  it('requires a voice model when voice extraction is enabled', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('PUBLIC_ENABLE_VOICE_EXPENSE', 'true')
    vi.stubEnv('AI_API_KEY', 'sk-test-key')
    vi.resetModules()
    await expect(import('./env')).rejects.toThrow(
      /AI_VOICE_MODEL must be specified/,
    )
  })
})

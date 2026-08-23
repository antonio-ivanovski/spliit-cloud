import { describe, expect, it } from 'vitest'

import { getConfiguredOidcProvider, parseEnv } from './env'

// Pure env-schema tests. Each case passes an isolated literal object to
// `parseEnv`, so assertions never depend on ambient environment files or
// module-load state — no vi.stubEnv/vi.resetModules involved.

function parseTestEnv(overrides: NodeJS.ProcessEnv = {}) {
  return parseEnv({
    NODE_ENV: 'development',
    ENABLE_MCP: 'false',
    ...overrides,
  })
}

// Complete explicit production baseline; individual cases override single
// keys (including explicitly `undefined`) instead of relying on absence.
const productionBase: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  BETTER_AUTH_SECRET: 'test-secret',
  SMTP_HOST: 'smtp.test',
  SMTP_USER: 'user',
  SMTP_PASS: 'pass',
  EMAIL_FROM: 'Spliit <noreply@test>',
  EMAIL_UNSUBSCRIBE_SECRET: 'a'.repeat(32),
}

describe('envSchema — production', () => {
  it('throws when SMTP_HOST is missing', () => {
    expect(() =>
      parseTestEnv({ ...productionBase, SMTP_HOST: undefined }),
    ).toThrow(/SMTP_HOST is required in production/)
  })

  it('throws when EMAIL_FROM is missing', () => {
    expect(() =>
      parseTestEnv({ ...productionBase, EMAIL_FROM: undefined }),
    ).toThrow(/EMAIL_FROM is required in production/)
  })

  it('allows an anonymous SMTP relay when both credentials are absent', () => {
    const env = parseTestEnv({
      ...productionBase,
      SMTP_USER: undefined,
      SMTP_PASS: undefined,
    })
    expect(env.SMTP_USER).toBeUndefined()
    expect(env.SMTP_PASS).toBeUndefined()
  })

  it('rejects partial SMTP credentials', () => {
    expect(() =>
      parseTestEnv({ ...productionBase, SMTP_PASS: undefined }),
    ).toThrow(/SMTP_USER and SMTP_PASS must be configured together/)
  })

  it('throws when the unsubscribe secret is too short', () => {
    expect(() =>
      parseTestEnv({
        ...productionBase,
        EMAIL_UNSUBSCRIBE_SECRET: 'too-short',
      }),
    ).toThrow(
      /EMAIL_UNSUBSCRIBE_SECRET must be at least 32 bytes in production/,
    )
  })

  it('parses successfully when all required production vars are set', () => {
    const env = parseTestEnv({
      ...productionBase,
      SMTP_PORT: '587',
      PUSH_VAPID_PUBLIC_KEY: 'public-key',
      PUSH_VAPID_PRIVATE_KEY: 'private-key',
      PUSH_VAPID_SUBJECT: 'mailto:test@example.com',
      ASSISTANT_CONFIRMATION_SECRET: 'b'.repeat(32),
    })
    expect(env.SMTP_HOST).toBe('smtp.test')
    expect(env.EMAIL_FROM).toBe('Spliit <noreply@test>')
    expect(env.SMTP_PORT).toBe(587)
  })
})

describe('envSchema — development', () => {
  it('allows all SMTP vars to be missing', () => {
    const env = parseTestEnv()
    expect(env.SMTP_HOST).toBeUndefined()
    expect(env.EMAIL_FROM).toBeUndefined()
    expect(env.SMTP_USER).toBeUndefined()
    expect(env.SMTP_PASS).toBeUndefined()
  })

  it('normalizes empty optional URLs to undefined', () => {
    const env = parseTestEnv({
      AI_BASE_URL: '',
      S3_UPLOAD_PUBLIC_URL: '',
      PUSH_VAPID_SUBJECT: '',
      MCP_PUBLIC_URL: '',
    })
    expect(env.AI_BASE_URL).toBeUndefined()
    expect(env.S3_UPLOAD_PUBLIC_URL).toBeUndefined()
    expect(env.PUSH_VAPID_SUBJECT).toBeUndefined()
    expect(env.MCP_PUBLIC_URL).toBeUndefined()
  })

  it('requires MCP secrets only when MCP is enabled', () => {
    expect(() => parseTestEnv({ ENABLE_MCP: 'true' })).toThrow(
      /MCP_PUBLIC_URL is required when ENABLE_MCP is true/,
    )
  })

  it('accepts complete MCP configuration when enabled', () => {
    const env = parseTestEnv({
      ENABLE_MCP: 'true',
      MCP_PUBLIC_URL: 'https://mcp.example.com',
      ASSISTANT_CONFIRMATION_SECRET: 'b'.repeat(32),
    })
    expect(env.ENABLE_MCP).toBe(true)
    expect(env.MCP_PUBLIC_URL).toBe('https://mcp.example.com')
  })

  it('defaults SIGNUP_MODE to open', () => {
    expect(parseTestEnv().SIGNUP_MODE).toBe('open')
  })

  it('defaults anonymous account creation to disabled', () => {
    expect(
      parseTestEnv({ ENABLE_ANONYMOUS_AUTH: '' }).ENABLE_ANONYMOUS_AUTH,
    ).toBe(false)
  })

  it('parses the deployed false value for anonymous account creation', () => {
    expect(
      parseTestEnv({ ENABLE_ANONYMOUS_AUTH: 'false' }).ENABLE_ANONYMOUS_AUTH,
    ).toBe(false)
  })

  it('parses enabled anonymous account creation', () => {
    const env = parseTestEnv({
      ENABLE_ANONYMOUS_AUTH: 'true',
      BETTER_AUTH_SECRET: 'test-secret',
      TRUST_PROXY: 'true',
    })
    expect(env.ENABLE_ANONYMOUS_AUTH).toBe(true)
  })

  it('requires a Better Auth secret for anonymous account creation', () => {
    expect(() =>
      parseTestEnv({
        ENABLE_ANONYMOUS_AUTH: 'true',
        BETTER_AUTH_SECRET: '',
        TRUST_PROXY: 'true',
      }),
    ).toThrow(
      /BETTER_AUTH_SECRET is required when ENABLE_ANONYMOUS_AUTH is true/,
    )
  })

  it('requires a trusted proxy for anonymous signup rate limits', () => {
    expect(() =>
      parseTestEnv({
        ENABLE_ANONYMOUS_AUTH: 'true',
        BETTER_AUTH_SECRET: 'test-secret',
        TRUST_PROXY: 'false',
      }),
    ).toThrow(/TRUST_PROXY is required when ENABLE_ANONYMOUS_AUTH is true/)
  })

  it('parses invite_only SIGNUP_MODE', () => {
    expect(parseTestEnv({ SIGNUP_MODE: 'invite_only' }).SIGNUP_MODE).toBe(
      'invite_only',
    )
  })

  it('rejects an invalid SIGNUP_MODE', () => {
    expect(() => parseTestEnv({ SIGNUP_MODE: 'secret' })).toThrow()
  })

  it('rejects an unsupported instance currency', () => {
    expect(() => parseTestEnv({ PUBLIC_DEFAULT_CURRENCY_CODE: 'ZZZ' })).toThrow(
      /unsupportedCurrencyCode/,
    )
  })
})

describe('envSchema — OIDC', () => {
  it('allows all OIDC vars to be missing', () => {
    const env = parseTestEnv({
      OIDC_CLIENT_ID: '',
      OIDC_CLIENT_SECRET: '',
      OIDC_DISCOVERY_URL: '',
      OIDC_DISPLAY_NAME: '',
      OIDC_PROVIDER_ID: '',
    })
    expect(env.OIDC_CLIENT_ID).toBeUndefined()
    expect(env.OIDC_CLIENT_SECRET).toBeUndefined()
    expect(env.OIDC_DISCOVERY_URL).toBeUndefined()
    expect(getConfiguredOidcProvider(env)).toBeUndefined()
  })

  it('rejects a partial OIDC configuration', () => {
    expect(() =>
      parseTestEnv({
        OIDC_CLIENT_ID: 'oidc-client',
        OIDC_CLIENT_SECRET: '',
        OIDC_DISCOVERY_URL: '',
        OIDC_DISPLAY_NAME: '',
        OIDC_PROVIDER_ID: '',
      }),
    ).toThrow(
      /OIDC_CLIENT_ID, OIDC_CLIENT_SECRET and OIDC_DISCOVERY_URL must be configured together/,
    )
  })

  it('rejects a display name without credentials', () => {
    expect(() =>
      parseTestEnv({
        OIDC_CLIENT_ID: '',
        OIDC_CLIENT_SECRET: '',
        OIDC_DISCOVERY_URL: '',
        OIDC_DISPLAY_NAME: 'Company SSO',
        OIDC_PROVIDER_ID: '',
      }),
    ).toThrow(
      /OIDC_CLIENT_ID, OIDC_CLIENT_SECRET and OIDC_DISCOVERY_URL must be configured together/,
    )
  })

  it('accepts a complete OIDC configuration and applies defaults', () => {
    const provider = getConfiguredOidcProvider(
      parseTestEnv({
        OIDC_CLIENT_ID: 'oidc-client',
        OIDC_CLIENT_SECRET: 'oidc-secret',
        OIDC_DISCOVERY_URL:
          'https://auth.example.com/.well-known/openid-configuration',
        OIDC_DISPLAY_NAME: '',
        OIDC_PROVIDER_ID: '',
      }),
    )
    expect(provider).toEqual({
      id: 'oidc',
      name: 'SSO',
      clientId: 'oidc-client',
      clientSecret: 'oidc-secret',
      discoveryUrl: 'https://auth.example.com/.well-known/openid-configuration',
    })
  })

  it('accepts custom provider id and display name', () => {
    const provider = getConfiguredOidcProvider(
      parseTestEnv({
        OIDC_CLIENT_ID: 'oidc-client',
        OIDC_CLIENT_SECRET: 'oidc-secret',
        OIDC_DISCOVERY_URL:
          'https://auth.example.com/.well-known/openid-configuration',
        OIDC_PROVIDER_ID: 'keycloak',
        OIDC_DISPLAY_NAME: 'Company SSO',
      }),
    )
    expect(provider).toEqual({
      id: 'keycloak',
      name: 'Company SSO',
      clientId: 'oidc-client',
      clientSecret: 'oidc-secret',
      discoveryUrl: 'https://auth.example.com/.well-known/openid-configuration',
    })
  })

  it('rejects an invalid OIDC_PROVIDER_ID', () => {
    expect(() => parseTestEnv({ OIDC_PROVIDER_ID: 'not a slug' })).toThrow(
      /OIDC_PROVIDER_ID must be a URL-safe identifier/,
    )
  })
})

describe('envSchema — AI', () => {
  it('applies default provider and models when AI settings are absent', () => {
    const env = parseTestEnv()
    expect(env.AI_PROVIDER).toBe('openai')
    expect(env.AI_RECEIPT_MODEL).toBe('gpt-5-nano')
    expect(env.AI_CATEGORY_MODEL).toBe('gpt-5-nano')
    expect(env.AI_VOICE_MODEL).toBeUndefined()
  })

  it('parses custom provider and models', () => {
    const env = parseTestEnv({
      AI_PROVIDER: 'anthropic',
      AI_RECEIPT_MODEL: 'claude-haiku-4-5',
      AI_CATEGORY_MODEL: 'claude-sonnet-4-5',
    })
    expect(env.AI_PROVIDER).toBe('anthropic')
    expect(env.AI_RECEIPT_MODEL).toBe('claude-haiku-4-5')
    expect(env.AI_CATEGORY_MODEL).toBe('claude-sonnet-4-5')
  })

  it.each(['openai', 'anthropic', 'openai-compatible', 'google'] as const)(
    'accepts the %s provider',
    (provider) => {
      expect(parseTestEnv({ AI_PROVIDER: provider }).AI_PROVIDER).toBe(provider)
    },
  )

  it('applies default AI_CATEGORY_RECENT_EXPENSES_LIMIT of 50 when absent', () => {
    expect(parseTestEnv().AI_CATEGORY_RECENT_EXPENSES_LIMIT).toBe(50)
  })

  it('parses a custom AI_CATEGORY_RECENT_EXPENSES_LIMIT', () => {
    expect(
      parseTestEnv({ AI_CATEGORY_RECENT_EXPENSES_LIMIT: '25' })
        .AI_CATEGORY_RECENT_EXPENSES_LIMIT,
    ).toBe(25)
  })

  it('throws when AI_CATEGORY_RECENT_EXPENSES_LIMIT is not a positive integer', () => {
    expect(() =>
      parseTestEnv({ AI_CATEGORY_RECENT_EXPENSES_LIMIT: '0' }),
    ).toThrow()
  })

  it('applies default CATEGORY_MEMORY_LIMIT of 200 when absent', () => {
    expect(parseTestEnv().CATEGORY_MEMORY_LIMIT).toBe(200)
  })

  it('parses a custom CATEGORY_MEMORY_LIMIT', () => {
    expect(
      parseTestEnv({ CATEGORY_MEMORY_LIMIT: '400' }).CATEGORY_MEMORY_LIMIT,
    ).toBe(400)
  })

  it('parses a valid AI_BASE_URL', () => {
    expect(
      parseTestEnv({ AI_BASE_URL: 'https://openrouter.ai/api/v1' }).AI_BASE_URL,
    ).toBe('https://openrouter.ai/api/v1')
  })

  it('allows AI_BASE_URL to be absent', () => {
    expect(parseTestEnv().AI_BASE_URL).toBeUndefined()
  })

  it('throws when AI_BASE_URL is an invalid URL', () => {
    expect(() => parseTestEnv({ AI_BASE_URL: 'not-a-url' })).toThrow()
  })

  it('throws when PUBLIC_ENABLE_RECEIPT_EXTRACT is true but AI_API_KEY is missing', () => {
    expect(() =>
      parseTestEnv({ PUBLIC_ENABLE_RECEIPT_EXTRACT: 'true' }),
    ).toThrow(/AI_API_KEY must be specified/)
  })

  it('throws when PUBLIC_ENABLE_CATEGORY_EXTRACT is true but AI_API_KEY is missing', () => {
    expect(() =>
      parseTestEnv({ PUBLIC_ENABLE_CATEGORY_EXTRACT: 'true' }),
    ).toThrow(/AI_API_KEY must be specified/)
  })

  it('parses successfully when both AI feature flags are enabled and AI_API_KEY is set', () => {
    const env = parseTestEnv({
      PUBLIC_ENABLE_RECEIPT_EXTRACT: 'true',
      PUBLIC_ENABLE_CATEGORY_EXTRACT: 'true',
      AI_API_KEY: 'sk-test-key',
    })
    expect(env.AI_API_KEY).toBe('sk-test-key')
    // defaults still apply
    expect(env.AI_RECEIPT_MODEL).toBe('gpt-5-nano')
    expect(env.AI_CATEGORY_MODEL).toBe('gpt-5-nano')
  })

  it('requires an AI key when voice extraction is enabled', () => {
    expect(() => parseTestEnv({ PUBLIC_ENABLE_VOICE_EXPENSE: 'true' })).toThrow(
      /AI_API_KEY must be specified/,
    )
  })

  it('requires a voice model when voice extraction is enabled', () => {
    expect(() =>
      parseTestEnv({
        PUBLIC_ENABLE_VOICE_EXPENSE: 'true',
        AI_API_KEY: 'sk-test-key',
      }),
    ).toThrow(/AI_VOICE_MODEL must be specified/)
  })
})

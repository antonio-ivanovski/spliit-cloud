import { afterEach, describe, expect, it } from 'vitest'

import '../../../test/mocks'
import { featuresRouter } from '.'
import { env } from '../../../lib/env'
import { prismaMock } from '../../../test/state'

const originalDeploymentValues = {
  PUBLIC_DEFAULT_CURRENCY_CODE: env.PUBLIC_DEFAULT_CURRENCY_CODE,
  MAX_EXPENSE_DOCUMENT_SIZE_MB: env.MAX_EXPENSE_DOCUMENT_SIZE_MB,
  GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET,
  GITHUB_CLIENT_ID: env.GITHUB_CLIENT_ID,
  GITHUB_CLIENT_SECRET: env.GITHUB_CLIENT_SECRET,
  TWITTER_CLIENT_ID: env.TWITTER_CLIENT_ID,
  TWITTER_CLIENT_SECRET: env.TWITTER_CLIENT_SECRET,
  OIDC_CLIENT_ID: env.OIDC_CLIENT_ID,
  OIDC_CLIENT_SECRET: env.OIDC_CLIENT_SECRET,
  OIDC_DISCOVERY_URL: env.OIDC_DISCOVERY_URL,
  OIDC_DISPLAY_NAME: env.OIDC_DISPLAY_NAME,
  OIDC_PROVIDER_ID: env.OIDC_PROVIDER_ID,
  ENABLE_ANONYMOUS_AUTH: env.ENABLE_ANONYMOUS_AUTH,
  ENABLE_EMAIL_AUTH: env.ENABLE_EMAIL_AUTH,
  ENABLE_PASSKEY_AUTH: env.ENABLE_PASSKEY_AUTH,
  SMTP_HOST: env.SMTP_HOST,
  EMAIL_FROM: env.EMAIL_FROM,
  SIGNUP_MODE: env.SIGNUP_MODE,
  CATEGORY_DICTIONARY_ENABLED: env.CATEGORY_DICTIONARY_ENABLED,
  CATEGORY_HISTORY_ENABLED: env.CATEGORY_HISTORY_ENABLED,
  AI_CATEGORY_ENGINE: env.AI_CATEGORY_ENGINE,
  CATEGORY_LOCAL_MIN_SCORE: env.CATEGORY_LOCAL_MIN_SCORE,
  CATEGORY_LOCAL_SETTLEMENT_MIN_SCORE: env.CATEGORY_LOCAL_SETTLEMENT_MIN_SCORE,
  AI_CATEGORY_MIN_CONFIDENCE: env.AI_CATEGORY_MIN_CONFIDENCE,
}

afterEach(() => {
  Object.assign(env, originalDeploymentValues)
})

describe('features.get', () => {
  it('returns runtime deployment configuration with the feature flags', async () => {
    Object.assign(env, {
      PUBLIC_DEFAULT_CURRENCY_CODE: 'EUR',
      MAX_EXPENSE_DOCUMENT_SIZE_MB: 10,
      GOOGLE_CLIENT_ID: 'google-client',
      GOOGLE_CLIENT_SECRET: 'google-secret',
      GITHUB_CLIENT_ID: 'github-client',
      GITHUB_CLIENT_SECRET: undefined,
      TWITTER_CLIENT_ID: 'twitter-client',
      TWITTER_CLIENT_SECRET: 'twitter-secret',
      OIDC_CLIENT_ID: 'oidc-client',
      OIDC_CLIENT_SECRET: 'oidc-secret',
      OIDC_DISCOVERY_URL:
        'https://auth.example.com/.well-known/openid-configuration',
      OIDC_DISPLAY_NAME: 'Company SSO',
      OIDC_PROVIDER_ID: 'keycloak',
      ENABLE_ANONYMOUS_AUTH: true,
      ENABLE_EMAIL_AUTH: true,
      ENABLE_PASSKEY_AUTH: true,
      SMTP_HOST: 'smtp.test',
      EMAIL_FROM: 'Spliit <noreply@test>',
      SIGNUP_MODE: 'open',
    })

    const result = await featuresRouter.createCaller({ auth: null }).get()

    expect(result).toMatchObject({
      defaultCurrencyCode: 'EUR',
      maxExpenseDocumentSize: 10 * 1024 * 1024,
      enableGoogleOAuth: true,
      enableGitHubOAuth: false,
      enableTwitterOAuth: true,
      oidcProviders: [{ id: 'keycloak', name: 'Company SSO' }],
      enableVoiceExpense: false,
      signupMode: 'open',
      allowUninvitedSignup: true,
      enableAnonymousAuth: true,
      enableEmailAuth: true,
      enablePasskeyAuth: true,
      emailDeliveryEnabled: true,
      passkeyFreshAgeSeconds: 30 * 24 * 60 * 60,
    })
  })

  it('exposes passkey auth capability', async () => {
    Object.assign(env, { ENABLE_PASSKEY_AUTH: false })

    await expect(
      featuresRouter.createCaller({ auth: null }).get(),
    ).resolves.toMatchObject({ enablePasskeyAuth: false })

    Object.assign(env, { ENABLE_PASSKEY_AUTH: true })

    await expect(
      featuresRouter.createCaller({ auth: null }).get(),
    ).resolves.toMatchObject({ enablePasskeyAuth: true })
  })

  it('exposes the category suggest stages, engine, and thresholds', async () => {
    Object.assign(env, {
      CATEGORY_DICTIONARY_ENABLED: false,
      CATEGORY_HISTORY_ENABLED: true,
      AI_CATEGORY_ENGINE: 'system-one',
      CATEGORY_LOCAL_MIN_SCORE: 0.8,
      CATEGORY_LOCAL_SETTLEMENT_MIN_SCORE: 0.97,
      AI_CATEGORY_MIN_CONFIDENCE: 0.6,
    })

    const result = await featuresRouter.createCaller({ auth: null }).get()

    expect(result).toMatchObject({
      enableDictionarySuggest: false,
      enableHistorySuggest: true,
      categoryEngine: 'system-one',
      categoryLocalThresholds: {
        minScore: 0.8,
        settlementMinScore: 0.97,
      },
      aiMinConfidence: 0.6,
    })
  })

  it('exposes SSO-only mode with delivery disabled', async () => {
    Object.assign(env, {
      ENABLE_EMAIL_AUTH: false,
      SMTP_HOST: undefined,
    })

    const result = await featuresRouter.createCaller({ auth: null }).get()

    expect(result.enableEmailAuth).toBe(false)
    expect(result.emailDeliveryEnabled).toBe(false)
  })

  it('reports delivery disabled when the sender identity is missing', async () => {
    Object.assign(env, {
      ENABLE_EMAIL_AUTH: false,
      SMTP_HOST: 'smtp.test',
      EMAIL_FROM: undefined,
    })

    const result = await featuresRouter.createCaller({ auth: null }).get()

    expect(result.emailDeliveryEnabled).toBe(false)
  })

  it('exposes anonymous auth capability in invite-only mode', async () => {
    Object.assign(env, {
      ENABLE_ANONYMOUS_AUTH: true,
      SIGNUP_MODE: 'invite_only',
    })
    prismaMock.user.count.mockResolvedValue(1)

    const result = await featuresRouter.createCaller({ auth: null }).get()

    expect(result.enableAnonymousAuth).toBe(true)
  })

  it('omits OIDC providers when credentials are unset', async () => {
    Object.assign(env, {
      OIDC_CLIENT_ID: undefined,
      OIDC_CLIENT_SECRET: undefined,
      OIDC_DISCOVERY_URL: undefined,
      OIDC_DISPLAY_NAME: undefined,
      OIDC_PROVIDER_ID: undefined,
    })

    const result = await featuresRouter.createCaller({ auth: null }).get()

    expect(result.oidcProviders).toEqual([])
  })
})

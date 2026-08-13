import { afterEach, describe, expect, it } from 'vitest'

import { featuresRouter } from '.'
import { env } from '../../../lib/env'

const originalDeploymentValues = {
  PUBLIC_DEFAULT_CURRENCY_CODE: env.PUBLIC_DEFAULT_CURRENCY_CODE,
  GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET,
  GITHUB_CLIENT_ID: env.GITHUB_CLIENT_ID,
  GITHUB_CLIENT_SECRET: env.GITHUB_CLIENT_SECRET,
  OIDC_CLIENT_ID: env.OIDC_CLIENT_ID,
  OIDC_CLIENT_SECRET: env.OIDC_CLIENT_SECRET,
  OIDC_DISCOVERY_URL: env.OIDC_DISCOVERY_URL,
  OIDC_DISPLAY_NAME: env.OIDC_DISPLAY_NAME,
  OIDC_PROVIDER_ID: env.OIDC_PROVIDER_ID,
}

afterEach(() => {
  Object.assign(env, originalDeploymentValues)
})

describe('features.get', () => {
  it('returns runtime deployment configuration with the feature flags', async () => {
    Object.assign(env, {
      PUBLIC_DEFAULT_CURRENCY_CODE: 'EUR',
      GOOGLE_CLIENT_ID: 'google-client',
      GOOGLE_CLIENT_SECRET: 'google-secret',
      GITHUB_CLIENT_ID: 'github-client',
      GITHUB_CLIENT_SECRET: undefined,
      OIDC_CLIENT_ID: 'oidc-client',
      OIDC_CLIENT_SECRET: 'oidc-secret',
      OIDC_DISCOVERY_URL:
        'https://auth.example.com/.well-known/openid-configuration',
      OIDC_DISPLAY_NAME: 'Company SSO',
      OIDC_PROVIDER_ID: 'keycloak',
    })

    const result = await featuresRouter.createCaller({ auth: null }).get()

    expect(result).toMatchObject({
      defaultCurrencyCode: 'EUR',
      enableGoogleOAuth: true,
      enableGitHubOAuth: false,
      oidcProviders: [{ id: 'keycloak', name: 'Company SSO' }],
      enableVoiceExpense: false,
      signupMode: 'open',
      allowUninvitedSignup: true,
    })
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

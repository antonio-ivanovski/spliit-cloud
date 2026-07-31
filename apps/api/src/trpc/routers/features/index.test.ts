import { afterEach, describe, expect, it } from 'vitest'

import { featuresRouter } from '.'
import { env } from '../../../lib/env'

const originalDeploymentValues = {
  PUBLIC_DEFAULT_CURRENCY_CODE: env.PUBLIC_DEFAULT_CURRENCY_CODE,
  GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET,
  GITHUB_CLIENT_ID: env.GITHUB_CLIENT_ID,
  GITHUB_CLIENT_SECRET: env.GITHUB_CLIENT_SECRET,
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
    })

    const result = await featuresRouter.createCaller({ auth: null }).get()

    expect(result).toMatchObject({
      defaultCurrencyCode: 'EUR',
      enableGoogleOAuth: true,
      enableGitHubOAuth: false,
    })
  })
})

import { describe, expect, it } from 'vitest'

import {
  buildOAuthAuthorizationUrl,
  resolveOAuthQuery,
} from '@/app/oauth/oauth-api'

describe('OAuth API helpers', () => {
  it('accepts Better Auth signed parameters directly from the page URL', () => {
    expect(
      resolveOAuthQuery(
        undefined,
        '?client_id=chatgpt&scope=openid%20email&sig=signed-value',
      ),
    ).toBe('client_id=chatgpt&scope=openid%20email&sig=signed-value')
  })

  it('accepts the legacy nested OAuth query format', () => {
    expect(
      resolveOAuthQuery(
        undefined,
        '?oauth_query=client_id%3Dchatgpt%26sig%3Dsigned-value',
      ),
    ).toBe('client_id=chatgpt&sig=signed-value')
  })

  it('restarts authorization without Better Auth hand-off signatures', () => {
    const url = new URL(
      buildOAuthAuthorizationUrl(
        'client_id=chatgpt&redirect_uri=https%3A%2F%2Fchatgpt.com%2Fcallback&scope=openid%20email&sig=secret&exp=123&ba_iat=456&ba_param=client_id&ba_param=sig',
      ),
    )

    expect(url.pathname).toBe('/auth/oauth2/authorize')
    expect(url.searchParams.get('client_id')).toBe('chatgpt')
    expect(url.searchParams.get('scope')).toBe('openid email')
    expect(url.searchParams.has('sig')).toBe(false)
    expect(url.searchParams.has('exp')).toBe(false)
    expect(url.searchParams.has('ba_iat')).toBe(false)
    expect(url.searchParams.has('ba_param')).toBe(false)
  })
})

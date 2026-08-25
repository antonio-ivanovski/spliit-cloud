import { describe, expect, it } from 'vitest'

import './test/mocks'
import { app } from './app'
import { ALL_SCOPES } from './lib/auth/scopes'
import { getApiBaseUrl } from './lib/auth/urls'

const emptyInput = encodeURIComponent(JSON.stringify({ json: {} }))

describe('OAuth protected resource discovery', () => {
  it('publishes RFC 9728 metadata for an unknown client', async () => {
    const response = await app.request('/.well-known/oauth-protected-resource')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(await response.json()).toEqual({
      resource: getApiBaseUrl(),
      authorization_servers: [new URL('/auth', getApiBaseUrl()).toString()],
      scopes_supported: [...ALL_SCOPES],
      bearer_methods_supported: ['header'],
      resource_name: 'Spliit API',
      resource_documentation: new URL('/docs', getApiBaseUrl()).toString(),
    })
  })

  it('challenges an unknown caller on an OAuth-enabled procedure', async () => {
    const response = await app.request(`/trpc/groups.list?input=${emptyInput}`)

    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toBe(
      `Bearer resource_metadata="${new URL(
        '/.well-known/oauth-protected-resource',
        getApiBaseUrl(),
      ).toString()}"`,
    )
    expect(response.headers.get('access-control-expose-headers')).toContain(
      'WWW-Authenticate',
    )
  })

  it('does not advertise OAuth for a session-only procedure', async () => {
    const response = await app.request(`/trpc/account.me?input=${emptyInput}`)

    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toBeNull()
  })
})

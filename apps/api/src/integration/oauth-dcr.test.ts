import { afterAll, describe, expect, it } from 'vitest'

import { prisma } from '@spliit/db'

import { app } from '../app'
import { ALL_SCOPES, SPLIIT_SCOPES } from '../lib/auth/scopes'
import { getApiBaseUrl } from '../lib/auth/urls'
import { checkDbConnection } from './setup'

await checkDbConnection()

describe('OAuth dynamic client registration', () => {
  const clientIds: string[] = []

  afterAll(async () => {
    await prisma.oauthClient.deleteMany({
      where: { clientId: { in: clientIds } },
    })
  })

  it('registers a minimal public client with the full requestable capability', async () => {
    const response = await app.request('/auth/oauth2/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Spliit OAuth integration test',
        redirect_uris: ['http://localhost:3002/oauth/callback'],
        token_endpoint_auth_method: 'none',
      }),
    })
    expect(response.status).toBe(201)

    const body = (await response.json()) as {
      client_id: string
      contacts: string[]
      post_logout_redirect_uris: string[]
      grant_types: string[]
      response_types: string[]
      scope: string
      resources: string[]
    }
    if (body.client_id) clientIds.push(body.client_id)

    expect(body).toMatchObject({
      contacts: [],
      post_logout_redirect_uris: [],
      grant_types: ['authorization_code'],
      response_types: ['code'],
      resources: [getApiBaseUrl()],
    })
    // Registration records what the client *may* request, not what the user
    // authorized: the capability set stays broad so the same client can step
    // up through fresh consent. Safety for omitted scopes lives at the
    // authorization endpoint, which defaults to the read-only set.
    const registeredScopes = body.scope.split(' ')
    for (const scope of ALL_SCOPES) {
      expect(registeredScopes).toContain(scope)
    }
    expect(registeredScopes).toEqual(
      expect.arrayContaining([
        SPLIIT_SCOPES.groupsRead,
        SPLIIT_SCOPES.expensesRead,
      ]),
    )
  })

  it('still registers manage scopes when a client asks for them by name', async () => {
    const requestedScope = [
      'openid',
      'offline_access',
      SPLIIT_SCOPES.groupsRead,
      SPLIIT_SCOPES.groupsManage,
      SPLIIT_SCOPES.expensesManage,
    ].join(' ')
    const response = await app.request('/auth/oauth2/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Spliit OAuth explicit-scope test',
        redirect_uris: ['http://localhost:3002/oauth/callback'],
        token_endpoint_auth_method: 'none',
        scope: requestedScope,
      }),
    })
    expect(response.status).toBe(201)

    const body = (await response.json()) as { client_id: string; scope: string }
    if (body.client_id) clientIds.push(body.client_id)

    // The stored capability covers every supported scope either way; the
    // explicit request is what the consent screen will show.
    for (const scope of requestedScope.split(' ')) {
      expect(body.scope.split(' ')).toContain(scope)
    }
  })

  it('allows browser-based public clients to preflight registration', async () => {
    const inspectorOrigin = 'https://inspector.example'
    const response = await app.request('/auth/oauth2/register', {
      method: 'OPTIONS',
      headers: {
        origin: inspectorOrigin,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    })

    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe(
      inspectorOrigin,
    )
    expect(response.headers.get('access-control-allow-methods')).toContain(
      'POST',
    )
  })
})

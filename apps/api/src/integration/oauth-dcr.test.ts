import { afterAll, describe, expect, it } from 'vitest'

import { prisma } from '@spliit/db'

import { app } from '../app'
import { checkDbConnection } from './setup'

await checkDbConnection()

describe('OAuth dynamic client registration', () => {
  const clientIds: string[] = []

  afterAll(async () => {
    await prisma.oauthClient.deleteMany({
      where: { clientId: { in: clientIds } },
    })
  })

  it('registers a minimal public MCP client without optional array fields', async () => {
    const response = await app.request('/auth/oauth2/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Spliit OAuth integration test',
        redirect_uris: ['http://localhost:3002/oauth/callback'],
        token_endpoint_auth_method: 'none',
      }),
    })

    const body = (await response.json()) as {
      client_id: string
      contacts: string[]
      post_logout_redirect_uris: string[]
      grant_types: string[]
      response_types: string[]
      scope: string
    }
    if (body.client_id) clientIds.push(body.client_id)

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      contacts: [],
      post_logout_redirect_uris: [],
      grant_types: ['authorization_code'],
      response_types: ['code'],
    })
    expect(body.scope.split(' ')).toEqual(
      expect.arrayContaining([
        'openid',
        'profile',
        'email',
        'offline_access',
        'spliit:groups:read',
        'spliit:expenses:write',
      ]),
    )
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

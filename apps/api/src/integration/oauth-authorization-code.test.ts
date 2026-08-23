import { createHash, randomBytes } from 'node:crypto'

import { makeSignature } from 'better-auth/crypto'
import { createLocalJWKSet, jwtVerify } from 'jose'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prisma } from '@spliit/db'

import { app } from '../app'
import { env } from '../lib/env'
import { assistantRouter } from '../trpc/routers/assistant'
import { groupsRouter } from '../trpc/routers/groups'
import { checkDbConnection, testRunId } from './setup'

await checkDbConnection()

const REDIRECT_URI = 'http://localhost:3002/oauth/callback'
const ISSUER = `${env.BETTER_AUTH_URL ?? 'http://localhost:3101'}/auth`
const AUDIENCE = `${env.MCP_PUBLIC_URL}/mcp`
const SCOPES =
  'openid profile email offline_access spliit:groups:read spliit:expenses:write'

const trackedClientIds: string[] = []
const trackedAccountIds: string[] = []

afterAll(async () => {
  if (trackedClientIds.length > 0) {
    await prisma.oauthClient.deleteMany({
      where: { clientId: { in: trackedClientIds } },
    })
  }
  if (trackedAccountIds.length > 0) {
    await prisma.session.deleteMany({
      where: { userId: { in: trackedAccountIds } },
    })
    await prisma.account.deleteMany({
      where: { id: { in: trackedAccountIds } },
    })
  }
})

function base64url(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function makePkce() {
  const verifier = base64url(randomBytes(32))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

async function registerClient(clientName: string): Promise<string> {
  const res = await app.request('/auth/oauth2/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: clientName,
      redirect_uris: [REDIRECT_URI],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    }),
  })
  const body = (await res.json()) as {
    client_id?: string
    error?: string
    error_description?: string
  }
  if (!res.ok || !body.client_id) {
    throw new Error(
      `client registration failed (${res.status}): ${JSON.stringify(body)}`,
    )
  }
  trackedClientIds.push(body.client_id)
  return body.client_id
}

/** Drive authorize -> consent page redirect -> consent approval -> code. */
async function authorizeToCode(opts: {
  clientId: string
  cookie: string
  challenge: string
  state: string
  scope?: string
  resource?: string
  accept?: boolean
}): Promise<{ code: string | null; callbackUrl: string; location: string }> {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: opts.clientId,
    redirect_uri: REDIRECT_URI,
    scope: opts.scope ?? SCOPES,
    state: opts.state,
    code_challenge: opts.challenge,
    code_challenge_method: 'S256',
  })
  if (opts.resource) params.set('resource', opts.resource)
  const authorizeRes = await app.request(
    `/auth/oauth2/authorize?${params.toString()}`,
    { method: 'GET', headers: { cookie: opts.cookie } },
  )
  expect(authorizeRes.status).toBeGreaterThanOrEqual(300)
  expect(authorizeRes.status).toBeLessThan(400)
  const location = authorizeRes.headers.get('location') ?? ''
  expect(location).toContain('/oauth/consent')

  // Mirror the web client: prefer an explicit oauth_query param, else the
  // whole signed query string Better Auth placed on the consent redirect.
  const search = new URL(location, 'http://localhost').search.replace(/^\?/, '')
  const oauthQuery = new URLSearchParams(search).get('oauth_query') ?? search

  const consentRes = await app.request('/auth/oauth2/consent', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: opts.cookie },
    body: JSON.stringify({
      accept: opts.accept ?? true,
      oauth_query: oauthQuery,
    }),
  })
  const consentBody = (await consentRes.json()) as {
    url?: string
    redirect_uri?: string
  }
  const callbackUrl = consentBody.url ?? consentBody.redirect_uri ?? ''
  expect(callbackUrl).toBeTruthy()
  const code = new URL(callbackUrl, 'http://localhost').searchParams.get('code')
  return { code, callbackUrl, location }
}

async function exchangeCode(opts: {
  clientId: string
  code: string
  verifier: string
  resource?: string
}): Promise<Response> {
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: opts.clientId,
    code: opts.code,
    code_verifier: opts.verifier,
    redirect_uri: REDIRECT_URI,
  })
  if (opts.resource) form.set('resource', opts.resource)
  return app.request('/auth/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  })
}

async function localJwks() {
  const res = await app.request('/auth/jwks')
  const jwks = (await res.json()) as Parameters<typeof createLocalJWKSet>[0]
  return createLocalJWKSet(jwks)
}

describe('OAuth authorization code + PKCE + refresh', () => {
  const runId = testRunId()

  // One verified account + one signed Better Auth session cookie reused by
  // every test: sign-up, credential sign-in and verification email are
  // covered by dedicated suites; this file only needs a valid session.
  let fixtureAccountId = ''
  let fixtureCookie = ''

  beforeAll(async () => {
    const rawToken = randomBytes(32).toString('base64url')
    const signature = await makeSignature(rawToken, env.BETTER_AUTH_SECRET)
    // One hour comfortably outlives a suite run while limiting damage if
    // cleanup never gets to run.
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60)
    // Transaction so a failed session insert cannot leak the account row.
    const accountId = await prisma.$transaction(async (tx) => {
      const account = await tx.account.create({
        data: {
          id: `oauth-fixture-${runId}`,
          email: `oauth-user-${runId}@test.example`,
          name: 'OAuth Fixture',
          emailVerified: true,
        },
      })
      await tx.session.create({
        data: {
          id: `oauth-fixture-sess-${runId}`,
          userId: account.id,
          token: rawToken,
          expiresAt,
        },
      })
      return account.id
    })
    trackedAccountIds.push(accountId)
    fixtureAccountId = accountId
    // Same value format Better Auth sets on sign-in: raw.signature.
    fixtureCookie = `better-auth.session_token=${rawToken}.${signature}`
  })

  it('completes the full flow and mints a verifiable MCP-audience token', async () => {
    const clientId = await registerClient(`OAuth flow ${runId}`)
    const { verifier, challenge } = makePkce()
    const accountId = fixtureAccountId

    const { code } = await authorizeToCode({
      clientId,
      cookie: fixtureCookie,
      challenge,
      state: `state-${runId}`,
      resource: AUDIENCE,
    })
    expect(code).toBeTruthy()

    const tokenRes = await exchangeCode({
      clientId,
      code: code!,
      verifier,
      resource: AUDIENCE,
    })
    expect(tokenRes.status).toBe(200)
    const tokens = (await tokenRes.json()) as {
      access_token: string
      refresh_token?: string
      token_type: string
      scope: string
      expires_in: number
    }
    expect(tokens.token_type.toLowerCase()).toBe('bearer')
    expect(tokens.access_token).toBeTruthy()
    expect(tokens.refresh_token).toBeTruthy()
    expect(tokens.scope.split(' ')).toEqual(
      expect.arrayContaining(['spliit:groups:read', 'spliit:expenses:write']),
    )

    // Signature + issuer + audience + expiry verified against the real JWKS.
    const jwks = await localJwks()
    const { payload } = await jwtVerify(tokens.access_token, jwks, {
      issuer: ISSUER,
      audience: AUDIENCE,
    })
    expect(payload.sub).toBe(accountId)
    expect(typeof payload.exp).toBe('number')

    // Exercise assistant procedures with the token's identity fields. This
    // does not exercise bearer-token parsing (getOAuthAuthFromRequest);
    // that security boundary has focused unit coverage in
    // lib/auth/session.test.ts, keeping remote JWKS I/O out of this test.
    const account = await prisma.account.findUnique({
      where: { id: accountId },
    })
    const groupCaller = groupsRouter.createCaller({
      auth: {
        session: { id: `sess-${runId}` },
        user: account,
      },
    } as never)
    const created = await groupCaller.create({
      requestId: crypto.randomUUID(),
      groupFormValues: {
        name: `OAuth Group ${runId}`,
        currency: '$',
        currencyCode: 'USD',
        participants: [{ name: 'OAuth Flow' }],
      },
    })
    const groupId = created.groupId

    const assistantCaller = assistantRouter.createCaller({
      auth: {
        credentialKind: 'oauth',
        accessToken: tokens.access_token,
        scopes: tokens.scope.split(' '),
        user: account,
        session: { id: `oauth:${accountId}` },
      },
    } as never)
    const context = await assistantCaller.listGroups()
    expect(context.connectedAccount.name).toBe(account?.name)
    expect(context.groups.map((group) => group.id)).toContain(groupId)

    // Refresh grant returns a new working access token.
    const refreshForm = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: tokens.refresh_token!,
      resource: AUDIENCE,
    })
    const refreshRes = await app.request('/auth/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: refreshForm.toString(),
    })
    expect(refreshRes.status).toBe(200)
    const refreshed = (await refreshRes.json()) as { access_token: string }
    const { payload: refreshedPayload } = await jwtVerify(
      refreshed.access_token,
      jwks,
      { issuer: ISSUER, audience: AUDIENCE },
    )
    expect(refreshedPayload.sub).toBe(accountId)

    await prisma.group.deleteMany({ where: { id: groupId } })
  })

  it('rejects token exchange when the PKCE verifier is wrong', async () => {
    const clientId = await registerClient(`OAuth PKCE ${runId}`)
    const { challenge } = makePkce()

    const { code } = await authorizeToCode({
      clientId,
      cookie: fixtureCookie,
      challenge,
      state: `state-pkce-${runId}`,
      resource: AUDIENCE,
    })
    expect(code).toBeTruthy()

    const tokenRes = await exchangeCode({
      clientId,
      code: code!,
      verifier: base64url(randomBytes(32)),
      resource: AUDIENCE,
    })
    expect(tokenRes.status).toBeGreaterThanOrEqual(400)
  })

  it('rejects a requested resource that is not a valid audience', async () => {
    const clientId = await registerClient(`OAuth audience ${runId}`)
    const { verifier, challenge } = makePkce()

    const { code } = await authorizeToCode({
      clientId,
      cookie: fixtureCookie,
      challenge,
      state: `state-aud-${runId}`,
    })
    expect(code).toBeTruthy()

    const tokenRes = await exchangeCode({
      clientId,
      code: code!,
      verifier,
      resource: 'https://evil.example/mcp',
    })
    expect(tokenRes.status).toBeGreaterThanOrEqual(400)
  })

  it('enforces scopes on the assistant write boundary', async () => {
    const clientId = await registerClient(`OAuth scope ${runId}`)
    const { verifier, challenge } = makePkce()
    const accountId = fixtureAccountId

    // Read-only scope set: no spliit:expenses:write.
    const readScope = 'openid profile offline_access spliit:groups:read'
    const { code } = await authorizeToCode({
      clientId,
      cookie: fixtureCookie,
      challenge,
      state: `state-scope-${runId}`,
      scope: readScope,
      resource: AUDIENCE,
    })
    expect(code).toBeTruthy()
    const tokenRes = await exchangeCode({
      clientId,
      code: code!,
      verifier,
      resource: AUDIENCE,
    })
    const tokens = (await tokenRes.json()) as {
      access_token: string
      scope: string
    }
    expect(tokens.scope.split(' ')).not.toContain('spliit:expenses:write')

    const account = await prisma.account.findUnique({
      where: { id: accountId },
    })
    const assistantCaller = assistantRouter.createCaller({
      auth: {
        credentialKind: 'oauth',
        accessToken: tokens.access_token,
        scopes: tokens.scope.split(' '),
        user: account,
        session: { id: `oauth:${accountId}` },
      },
    } as never)

    // Read works...
    await expect(assistantCaller.listGroups()).resolves.toBeTruthy()
    // ...but the write procedure rejects the missing scope.
    await expect(
      assistantCaller.prepareExpense({
        groupId: 'group-x',
        amount: '10',
        title: 'Lunch',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})

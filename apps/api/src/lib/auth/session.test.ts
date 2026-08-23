import { beforeEach, describe, expect, it, vi } from 'vitest'

import '../../test/mocks'
import { prismaMock } from '../../test/state'

const verifyBearerTokenMock = vi.hoisted(() => vi.fn())

vi.mock('@better-auth/oauth-provider/resource-client', () => ({
  oauthProviderResourceClient: () => ({
    getActions: () => ({ verifyBearerToken: verifyBearerTokenMock }),
  }),
}))

// Live env overrides let the MCP guard branches run without module reloads.
const envState = vi.hoisted(() => ({
  overrides: {} as Record<string, unknown>,
}))

vi.mock(import('../env'), async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    env: new Proxy(actual.env, {
      get(target, property, receiver) {
        if (property in envState.overrides) {
          return envState.overrides[property as string]
        }
        return Reflect.get(target, property, receiver)
      },
    }),
  }
})

import { getOAuthAuthFromRequest } from './session'
import type { OAuthResolvedAuth } from './session'

// Mirrors .env.test values the real env module loads.
const API_BASE = 'http://localhost:3001'
const AUDIENCE = 'http://localhost:3002/mcp'

function bearerRequest(token?: string): Request {
  return new Request('https://api.example/trpc/groups.list', {
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  })
}

function accountRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'account-1',
    email: 'mcp-user@example.com',
    emailVerified: true,
    isAnonymous: false,
    name: 'MCP User',
    image: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  }
}

describe('getOAuthAuthFromRequest', () => {
  beforeEach(() => {
    verifyBearerTokenMock.mockReset()
    envState.overrides = {}
  })

  it('verifies the bearer token against the local issuer and MCP audience', async () => {
    prismaMock.account.findUnique.mockResolvedValue(accountRow() as never)
    verifyBearerTokenMock.mockResolvedValue({
      sub: 'account-1',
      scopes: ['openid'],
      sid: 'sess-9',
      exp: 1000,
      iat: 900,
    })

    const resolved = await getOAuthAuthFromRequest(bearerRequest('tok-123'))

    expect(resolved).not.toBeNull()
    expect(verifyBearerTokenMock).toHaveBeenCalledWith('tok-123', {
      verifyOptions: { audience: AUDIENCE, issuer: `${API_BASE}/auth` },
      jwksUrl: `${API_BASE}/auth/jwks`,
    })
    expect(prismaMock.account.findUnique).toHaveBeenCalledWith({
      where: { id: 'account-1' },
    })
  })

  it('maps verified claims to account, scopes and session', async () => {
    const row = accountRow()
    prismaMock.account.findUnique.mockResolvedValue(row as never)
    verifyBearerTokenMock.mockResolvedValue({
      sub: 'account-1',
      scopes: ['openid', 'spliit:groups:read', 42, null],
      sid: 'sess-9',
      exp: 1000,
      iat: 900,
    })

    const resolved = (await getOAuthAuthFromRequest(
      bearerRequest('tok-123'),
    )) as OAuthResolvedAuth

    expect(resolved.credentialKind).toBe('oauth')
    expect(resolved.accessToken).toBe('tok-123')
    // Non-string entries in a scopes array are dropped, not passed through.
    expect(resolved.scopes).toEqual(['openid', 'spliit:groups:read'])
    expect(resolved.user).toEqual({
      ...row,
      anonymousOnboardingCompleted: true,
    })
    expect(resolved.session).toEqual({
      id: 'sess-9',
      userId: 'account-1',
      token: '',
      expiresAt: new Date(1_000_000),
      createdAt: new Date(900_000),
      updatedAt: new Date(900_000),
      ipAddress: null,
      userAgent: null,
    })
  })

  it('falls back to a space-separated scope claim and derived session id', async () => {
    prismaMock.account.findUnique.mockResolvedValue(accountRow() as never)
    verifyBearerTokenMock.mockResolvedValue({
      sub: 'account-1',
      exp: 1000,
      iat: 900,
      scope: 'openid profile spliit:groups:read',
    })

    const scoped = (await getOAuthAuthFromRequest(
      bearerRequest('tok-456'),
    )) as OAuthResolvedAuth

    expect(scoped.scopes).toEqual(['openid', 'profile', 'spliit:groups:read'])
    expect(scoped.accessToken).toBe('tok-456')
    // No `sid` in claims → session id is derived from subject, temporal
    // fields come from verified exp/iat rather than epoch defaults.
    expect(scoped.session.id).toBe('oauth:account-1')
    expect(scoped.session.expiresAt).toEqual(new Date(1_000_000))
    expect(scoped.session.createdAt).toEqual(new Date(900_000))
  })

  it('rejects claims without finite numeric exp and iat', async () => {
    const badClaims = [
      { sub: 'account-1' },
      { sub: 'account-1', exp: 1000 },
      { sub: 'account-1', iat: 900 },
      { sub: 'account-1', exp: '1000' as unknown as number, iat: 900 },
      { sub: 'account-1', exp: 1000, iat: '900' as unknown as number },
      { sub: 'account-1', exp: NaN, iat: 900 },
      { sub: 'account-1', exp: 1000, iat: Infinity },
      { sub: 'account-1', exp: null as unknown as number, iat: 900 },
    ]
    for (const claims of badClaims) {
      verifyBearerTokenMock.mockResolvedValue(claims)
      expect(await getOAuthAuthFromRequest(bearerRequest('tok-123'))).toBeNull()
    }
    // Rejected before the subject lookup, so no DB I/O for expiry-less tokens.
    expect(prismaMock.account.findUnique).not.toHaveBeenCalled()
  })

  it('returns null for requests without a usable bearer token', async () => {
    expect(await getOAuthAuthFromRequest(bearerRequest())).toBeNull()
    expect(
      await getOAuthAuthFromRequest(
        new Request('https://api.example', {
          headers: { authorization: 'Basic dXNlcjpwYXNz' },
        }),
      ),
    ).toBeNull()
    expect(await getOAuthAuthFromRequest(bearerRequest(''))).toBeNull()
    expect(verifyBearerTokenMock).not.toHaveBeenCalled()
  })

  it('returns null when claims lack a subject', async () => {
    for (const claims of [
      { scopes: ['openid'] },
      { sub: undefined as unknown as string, scopes: ['openid'] },
      { sub: 42 as unknown as string, scopes: ['openid'] },
      { sub: null as unknown as string, scopes: ['openid'] },
    ]) {
      verifyBearerTokenMock.mockResolvedValue(claims)
      expect(await getOAuthAuthFromRequest(bearerRequest('tok-123'))).toBeNull()
    }
    expect(prismaMock.account.findUnique).not.toHaveBeenCalled()
  })

  it('returns null when the subject has no account', async () => {
    prismaMock.account.findUnique.mockResolvedValue(null as never)
    verifyBearerTokenMock.mockResolvedValue({
      sub: 'ghost',
      exp: 1000,
      iat: 900,
    })
    expect(await getOAuthAuthFromRequest(bearerRequest('tok-123'))).toBeNull()
    expect(prismaMock.account.findUnique).toHaveBeenCalledWith({
      where: { id: 'ghost' },
    })
  })

  it('returns null when MCP is disabled or unconfigured', async () => {
    envState.overrides.ENABLE_MCP = false
    expect(await getOAuthAuthFromRequest(bearerRequest('tok-123'))).toBeNull()

    envState.overrides = { MCP_PUBLIC_URL: '' }
    expect(await getOAuthAuthFromRequest(bearerRequest('tok-123'))).toBeNull()

    expect(verifyBearerTokenMock).not.toHaveBeenCalled()
    expect(prismaMock.account.findUnique).not.toHaveBeenCalled()
  })
})

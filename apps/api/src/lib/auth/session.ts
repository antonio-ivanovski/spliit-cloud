import { oauthProviderResourceClient } from '@better-auth/oauth-provider/resource-client'

import { prisma } from '@spliit/db'

import { env } from '../env'
import { auth } from './index'
import { getApiBaseUrl } from './urls'

export type ResolvedAuth = NonNullable<
  Awaited<ReturnType<typeof auth.api.getSession>>
>

export type OAuthResolvedAuth = {
  credentialKind: 'oauth'
  user: ResolvedAuth['user']
  session: ResolvedAuth['session']
  scopes: string[]
  accessToken: string
}

/**
 * Resolve the authenticated account (and its better-auth session) for a given
 * request. Returns `null` when the request is unauthenticated or the session is
 * no longer valid. Account is eagerly refreshed from the database so that
 * callers always observe the latest email-verified / display-name state.
 */
export async function getAuthFromRequest(
  request: Request,
): Promise<ResolvedAuth | null> {
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session) return null

  // Re-fetch the account to make sure we have up-to-date fields (display name,
  // email, etc.) since better-auth only returns the session-shaped user.
  const account = await prisma.account.findUnique({
    where: { id: session.user.id },
  })
  if (!account) return null

  return { ...session, user: account }
}

const oauthResource = oauthProviderResourceClient().getActions()

export async function getOAuthAuthFromRequest(
  request: Request,
): Promise<OAuthResolvedAuth | null> {
  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith('Bearer ')) return null
  const accessToken = authorization.slice('Bearer '.length)
  if (!accessToken) return null

  const issuer = `${getApiBaseUrl()}/auth`
  const claims = await oauthResource.verifyAccessToken(accessToken, {
    verifyOptions: {
      audience: `${env.MCP_PUBLIC_URL}/mcp`,
      issuer,
    },
    jwksUrl: `${issuer}/jwks`,
  })
  if (typeof claims.sub !== 'string') return null
  const account = await prisma.account.findUnique({
    where: { id: claims.sub },
  })
  if (!account) return null
  const scopes = Array.isArray(claims.scopes)
    ? claims.scopes.filter(
        (scope): scope is string => typeof scope === 'string',
      )
    : typeof claims.scope === 'string'
      ? claims.scope.split(' ').filter(Boolean)
      : []

  return {
    credentialKind: 'oauth',
    accessToken,
    scopes,
    user: account,
    session: {
      id: typeof claims.sid === 'string' ? claims.sid : `oauth:${claims.sub}`,
      userId: account.id,
      token: '',
      expiresAt: new Date(Number(claims.exp ?? 0) * 1000),
      createdAt: new Date(Number(claims.iat ?? 0) * 1000),
      updatedAt: new Date(Number(claims.iat ?? 0) * 1000),
      ipAddress: null,
      userAgent: null,
    },
  }
}

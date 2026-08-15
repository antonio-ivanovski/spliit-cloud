import { oauthProviderResourceClient } from '@better-auth/oauth-provider/resource-client'

import { prisma } from '@spliit/db'

import { env } from '../env'
import {
  getCachedAccount,
  isAnonymousSetupIncomplete,
  type CachedAccount,
} from './account-cache'
import { auth } from './index'
import { getApiBaseUrl } from './urls'

export type ResolvedAuth = Omit<
  NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>,
  'user'
> & {
  user: CachedAccount
}

export type OAuthResolvedAuth = {
  credentialKind: 'oauth'
  user: ResolvedAuth['user']
  session: ResolvedAuth['session']
  scopes: string[]
  accessToken: string
}

export async function getAuthFromRequest(
  request: Request,
): Promise<ResolvedAuth | null> {
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session) return null

  const account = await getCachedAccount(session.user.id)
  if (!account) return null

  return { ...session, user: account }
}

export async function getApplicationAuthFromRequest(
  request: Request,
): Promise<
  | { auth: ResolvedAuth; response?: never }
  | { auth?: never; response: Response }
> {
  const auth = await getAuthFromRequest(request)
  if (!auth) {
    return {
      response: Response.json({ error: 'Unauthenticated' }, { status: 401 }),
    }
  }
  if (isAnonymousSetupIncomplete(auth.user)) {
    return {
      response: Response.json(
        { error: 'ANONYMOUS_SETUP_REQUIRED' },
        { status: 428 },
      ),
    }
  }
  return { auth }
}

const oauthResource = oauthProviderResourceClient().getActions()

export async function getOAuthAuthFromRequest(
  request: Request,
): Promise<OAuthResolvedAuth | null> {
  if (!env.ENABLE_MCP || !env.MCP_PUBLIC_URL) return null
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
    user: {
      ...account,
      anonymousOnboardingCompleted: true,
    },
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

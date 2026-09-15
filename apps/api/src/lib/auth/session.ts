import { oauthProviderResourceClient } from '@better-auth/oauth-provider/resource-client'

import { prisma } from '@spliit/db'

import {
  getCachedAccount,
  isAnonymousSetupIncomplete,
  type CachedAccount,
} from './account-cache'
import { auth } from './index'
import {
  getAccessTokenBinding,
  getGrantGeneration,
} from './oauth-grant-generation'
import { oauthRevocationBarrierIdentifier } from './oauth-revocation-barrier'
import { getApiBaseUrl, oauthAudiences } from './urls'

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
  /**
   * The token's verified `aud` claim. Each surface checks its own resource
   * against this list: `apiProcedure` and `scopedGroupReadProcedure` require
   * the API base URL, so a token minted for the MCP resource can never reach
   * the direct API (RFC 8707 audience separation). The assistant surface is the
   * MCP resource's backend and keeps accepting MCP-audience tokens.
   */
  audiences: string[]
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

/**
 * Whether the verified JWT belongs to the pair's current authorization
 * generation. A standing revocation barrier rejects first: the barrier commits
 * before the generation moves, so a crash between the two must still cut bearer
 * access (the exchange path is already barrier-gated). Bound tokens (by `jti`)
 * must then match the current generation exactly. Unbound tokens — minted
 * before binding shipped, or whose binding write was lost — cannot prove their
 * generation, so they are rejected once the pair has any revocation history and
 * accepted only on a pair that was never revoked. Any database failure rejects
 * the token.
 */
async function isAccessTokenGenerationCurrent(claims: {
  sub?: unknown
  client_id?: unknown
  azp?: unknown
  jti?: unknown
  iat?: unknown
}): Promise<boolean> {
  try {
    if (typeof claims.sub !== 'string') return false
    // Better Auth's verifier already normalizes `azp` into `client_id`, but
    // keep the legacy claim as a fallback so pre-1.7-shaped tokens stay
    // resolvable even if that normalization ever changes.
    const clientId =
      typeof claims.client_id === 'string'
        ? claims.client_id
        : typeof claims.azp === 'string'
          ? claims.azp
          : null
    if (!clientId) return false
    const [binding, current, barrier] = await Promise.all([
      typeof claims.jti === 'string'
        ? getAccessTokenBinding(claims.sub, clientId, claims.jti)
        : Promise.resolve(null),
      getGrantGeneration(claims.sub, clientId),
      prisma.verification.findFirst({
        where: {
          identifier: oauthRevocationBarrierIdentifier(claims.sub, clientId),
          expiresAt: { gt: new Date() },
        },
        select: { id: true },
      }),
    ])
    // A standing barrier means disconnect was requested and no explicit
    // re-consent has re-armed the pair since: reject regardless of generation.
    if (barrier) return false
    if (binding) {
      return (
        binding.accountId === claims.sub &&
        binding.clientId === clientId &&
        binding.generation === current
      )
    }
    return current === 0
  } catch {
    return false
  }
}

export async function getOAuthAuthFromRequest(
  request: Request,
): Promise<OAuthResolvedAuth | null> {
  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith('Bearer ')) return null
  const accessToken = authorization.slice('Bearer '.length)
  if (!accessToken) return null

  const issuer = `${getApiBaseUrl()}/auth`
  const claims = await oauthResource.verifyBearerToken(accessToken, {
    verifyOptions: {
      // Verification accepts any audience this deployment issues tokens for,
      // because the assistant surface must keep authenticating MCP-audience
      // tokens. Which resources a token may actually reach is decided per
      // surface from the verified `aud` claim exposed below.
      audience: oauthAudiences(),
      issuer,
    },
    jwksUrl: `${issuer}/jwks`,
  })
  if (typeof claims.sub !== 'string') return null
  if (
    typeof claims.exp !== 'number' ||
    !Number.isFinite(claims.exp) ||
    typeof claims.iat !== 'number' ||
    !Number.isFinite(claims.iat)
  )
    return null
  const account = await getCachedAccount(claims.sub)
  if (!account) return null
  // Disconnect moves the (account, client) pair to the next authorization
  // generation, which must reject already-issued access tokens on their
  // next use rather than leaving them valid until expiry. The check reads
  // the database so it holds across API replicas.
  if (!(await isAccessTokenGenerationCurrent(claims))) return null
  const scopes = Array.isArray(claims.scopes)
    ? claims.scopes.filter(
        (scope): scope is string => typeof scope === 'string',
      )
    : typeof claims.scope === 'string'
      ? claims.scope.split(' ').filter(Boolean)
      : []
  const audiences = Array.isArray(claims.aud)
    ? claims.aud.filter(
        (audience): audience is string => typeof audience === 'string',
      )
    : typeof claims.aud === 'string'
      ? [claims.aud]
      : []

  return {
    credentialKind: 'oauth',
    accessToken,
    scopes,
    audiences,
    user: account,
    session: {
      id: typeof claims.sid === 'string' ? claims.sid : `oauth:${claims.sub}`,
      userId: account.id,
      token: '',
      expiresAt: new Date(claims.exp * 1000),
      createdAt: new Date(claims.iat * 1000),
      updatedAt: new Date(claims.iat * 1000),
      ipAddress: null,
      userAgent: null,
    },
  }
}

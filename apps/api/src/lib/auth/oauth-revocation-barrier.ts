import { createHash, randomUUID } from 'node:crypto'

import { APIError } from 'better-auth/api'

import { prisma, type Prisma } from '@spliit/db'

import {
  codeGrantGeneration,
  decodeJwtPayload,
  getGrantGeneration,
  getRefreshFamilyGeneration,
  recordAccessTokenBinding,
  recordRefreshFamilyGeneration,
  tagAuthorizationCodesWithGeneration,
} from './oauth-grant-generation'

const REVOCATION_BARRIER_PREFIX = 'spliit:oauth-revocation:'
const REVOCATION_BARRIER_EXPIRY = new Date('9999-12-31T23:59:59.999Z')

type GrantSnapshot = {
  accountId: string
  authorizationCodeId: string | null
  clientId: string
  issuedAt: Date
  kind: 'authorization_code' | 'refresh_token'
  /**
   * Integer authorization generation the grant was born with. Null when the
   * grant predates generation tagging; such grants are rejected once the pair
   * has any revocation history, and otherwise fall back to the
   * timestamp/barrier check below.
   */
  grantGeneration: number | null
}

const pendingTokenExchanges = new WeakMap<Request, GrantSnapshot>()
const pendingConsentApprovals = new WeakMap<Request, Date>()

type AuthorizationStart = {
  accountId: string
  clientId: string
  /** Generation active when the authorization started, not when it lands. */
  generation: number
  startedAt: Date
}

const pendingAuthorizationStarts = new WeakMap<Request, AuthorizationStart>()

/**
 * Better Auth `databaseHooks.verification.create.before` entry: stamp an
 * authorization code with its start generation as the row is written.
 *
 * This is the hook that closes the delayed-authorization race. Direct
 * authorizations (existing consent, no consent page) answer with a thrown
 * redirect that never reaches the auth after-hook, so post-hoc tagging cannot
 * see them. Stamping at row creation runs inside the authorization itself —
 * even one paused across a disconnect — and reads the generation captured when
 * that authorization started, never the current one.
 */
export async function stampOAuthAuthorizationCodeValue(
  verification: Record<string, unknown>,
  context: { request?: Request | null } | null,
): Promise<{ data: Record<string, unknown> } | void> {
  const request = context?.request
  if (!request) return
  const start = pendingAuthorizationStarts.get(request)
  if (!start) return
  const rawValue = verification.value
  if (typeof rawValue !== 'string') return
  let parsed: {
    type?: unknown
    userId?: unknown
    grantGeneration?: unknown
    query?: { client_id?: unknown }
  }
  try {
    parsed = JSON.parse(rawValue) as typeof parsed
  } catch {
    return
  }
  if (parsed.type !== 'authorization_code') return
  if (
    parsed.userId !== start.accountId ||
    parsed.query?.client_id !== start.clientId
  ) {
    return
  }
  if (typeof parsed.grantGeneration === 'number') return
  return {
    data: {
      ...verification,
      value: JSON.stringify({ ...parsed, grantGeneration: start.generation }),
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function storedToken(rawToken: string): string {
  // Spliit uses Better Auth's default hashed token storage and does not add a
  // token prefix. Authorization codes and refresh tokens therefore use the
  // same unpadded base64url SHA-256 representation in the database.
  return createHash('sha256').update(rawToken).digest('base64url')
}

export function oauthRevocationBarrierIdentifier(
  accountId: string,
  clientId: string,
): string {
  const subject = createHash('sha256')
    .update(accountId)
    .update('\0')
    .update(clientId)
    .digest('base64url')
  return `${REVOCATION_BARRIER_PREFIX}${subject}`
}

function parseAuthorizationCode(value: string): {
  accountId: string
  clientId: string
} | null {
  try {
    const parsed = JSON.parse(value) as {
      type?: unknown
      userId?: unknown
      query?: { client_id?: unknown }
    }
    if (
      parsed.type !== 'authorization_code' ||
      typeof parsed.userId !== 'string' ||
      typeof parsed.query?.client_id !== 'string'
    ) {
      return null
    }
    return { accountId: parsed.userId, clientId: parsed.query.client_id }
  } catch {
    return null
  }
}

async function findAuthorizationCodeSnapshot(
  body: Record<string, unknown>,
): Promise<GrantSnapshot | null> {
  if (typeof body.code !== 'string') return null

  const authorizationCodeId = storedToken(body.code)
  const code = await prisma.verification.findFirst({
    where: {
      identifier: authorizationCodeId,
      expiresAt: { gt: new Date() },
    },
    select: { createdAt: true, value: true },
  })
  if (!code) return null

  const owner = parseAuthorizationCode(code.value)
  if (!owner) return null

  return {
    ...owner,
    authorizationCodeId,
    issuedAt: code.createdAt,
    kind: 'authorization_code',
    grantGeneration: codeGrantGeneration(code.value),
  }
}

async function findRefreshTokenSnapshot(
  body: Record<string, unknown>,
): Promise<GrantSnapshot | null> {
  if (typeof body.refresh_token !== 'string') return null

  const token = await prisma.oauthRefreshToken.findUnique({
    where: { token: storedToken(body.refresh_token) },
    select: {
      authorizationCodeId: true,
      clientId: true,
      createdAt: true,
      userId: true,
    },
  })
  if (!token) return null

  return {
    accountId: token.userId,
    authorizationCodeId: token.authorizationCodeId,
    clientId: token.clientId,
    issuedAt: token.createdAt ?? new Date(0),
    kind: 'refresh_token',
    grantGeneration: await getRefreshFamilyGeneration(
      token.authorizationCodeId,
    ),
  }
}

async function findGrantSnapshot(body: unknown): Promise<GrantSnapshot | null> {
  if (!isRecord(body)) return null
  if (body.grant_type === 'authorization_code') {
    return findAuthorizationCodeSnapshot(body)
  }
  if (body.grant_type === 'refresh_token') {
    return findRefreshTokenSnapshot(body)
  }
  return null
}

async function grantWasRevoked(snapshot: GrantSnapshot): Promise<boolean> {
  const [barrier, consent] = await Promise.all([
    prisma.verification.findFirst({
      where: {
        identifier: oauthRevocationBarrierIdentifier(
          snapshot.accountId,
          snapshot.clientId,
        ),
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
    prisma.oauthConsent.findFirst({
      where: { userId: snapshot.accountId, clientId: snapshot.clientId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
  ])

  // A standing barrier is fail-closed until a successful, explicit consent
  // re-arms the pair. This also rejects a code created late by an authorize
  // request that read the old consent just before it was deleted.
  if (barrier) return true

  // The monotonic generation check is the durable form of the same rule.
  // Unlike timestamps — which the provider truncates to whole seconds when
  // minting codes — generations stay ordered across disconnect and
  // reconnect, so work born before a revocation can never be revived by a
  // later consent.
  const current = await getGrantGeneration(
    snapshot.accountId,
    snapshot.clientId,
  )
  if (snapshot.grantGeneration !== null) {
    if (snapshot.grantGeneration < current) return true
  } else if (current > 0) {
    // Untagged grants on a pair with revocation history cannot prove which
    // generation they belong to. Codes live ten minutes, so anything
    // legitimately untagged (minted before tagging shipped) has long
    // expired; reject rather than let second-precision timestamps decide.
    return true
  }

  // A newer consent denotes an explicit reauthorization. It must never revive
  // an authorization code or refresh-token family from the previous grant.
  return Boolean(consent?.createdAt && snapshot.issuedAt < consent.createdAt)
}

async function quarantineGrant(snapshot: GrantSnapshot): Promise<void> {
  const familyWhere = snapshot.authorizationCodeId
    ? { authorizationCodeId: snapshot.authorizationCodeId }
    : snapshot.kind === 'refresh_token'
      ? { authorizationCodeId: null }
      : null
  if (!familyWhere) return

  const now = new Date()
  await prisma.$transaction(async (tx) => {
    await tx.oauthAccessToken.deleteMany({
      where: {
        userId: snapshot.accountId,
        clientId: snapshot.clientId,
        ...familyWhere,
      },
    })
    await tx.oauthRefreshToken.updateMany({
      where: {
        userId: snapshot.accountId,
        clientId: snapshot.clientId,
        ...familyWhere,
      },
      data: {
        revoked: now,
        rotationReplayResponse: null,
        rotationReplayExpiresAt: null,
      },
    })
  })
}

function invalidGrantResponse(): Response {
  return Response.json(
    {
      error: 'invalid_grant',
      error_description: 'The authorization grant is no longer valid.',
    },
    {
      status: 400,
      headers: {
        'Cache-Control': 'no-store',
        Pragma: 'no-cache',
      },
    },
  )
}

/**
 * Capture and validate the grant before Better Auth consumes or rotates it.
 *
 * The matching after-hook validates the same snapshot again. Together those
 * checks close the useful race window: token issuance either linearizes before
 * revocation (and is swept by it), or observes the barrier afterwards and its
 * response is replaced after the newly-created token rows are quarantined.
 */
export async function prepareOAuthTokenExchange(
  request: Request | undefined,
  body: unknown,
): Promise<void> {
  if (!request) return
  const snapshot = await findGrantSnapshot(body)
  if (!snapshot) return
  pendingTokenExchanges.set(request, snapshot)

  if (!(await grantWasRevoked(snapshot))) return

  if (snapshot.kind === 'authorization_code') {
    await prisma.verification.deleteMany({
      where: { identifier: snapshot.authorizationCodeId! },
    })
  } else {
    await quarantineGrant(snapshot)
  }
  throw new APIError('BAD_REQUEST', {
    error: 'invalid_grant',
    error_description: 'The authorization grant is no longer valid.',
  })
}

/**
 * Recheck a token exchange after Better Auth has created its token rows.
 *
 * On a valid exchange, carry the grant's generation forward: codes seed their
 * refresh-token family row, and every access token JWT is bound to the
 * generation by its `jti` so bearer validation can reject it after a later
 * disconnect without waiting for expiry.
 */
export async function finalizeOAuthTokenExchange(
  request: Request | undefined,
  returned: unknown = null,
): Promise<Response | null> {
  if (!request) return null
  const snapshot = pendingTokenExchanges.get(request)
  pendingTokenExchanges.delete(request)
  if (!snapshot || !(await grantWasRevoked(snapshot))) {
    if (snapshot) await recordGrantGeneration(snapshot, returned)
    return null
  }

  await quarantineGrant(snapshot)
  return invalidGrantResponse()
}

async function recordGrantGeneration(
  snapshot: GrantSnapshot,
  returned: unknown,
): Promise<void> {
  try {
    const generation =
      snapshot.grantGeneration ??
      (await getGrantGeneration(snapshot.accountId, snapshot.clientId))
    if (
      snapshot.kind === 'authorization_code' &&
      snapshot.authorizationCodeId
    ) {
      await recordRefreshFamilyGeneration(
        snapshot.authorizationCodeId,
        generation,
      )
    }
    const body = await extractTokenResponseBody(returned)
    const accessToken =
      body && typeof body.access_token === 'string' ? body.access_token : null
    if (!accessToken) return
    const payload = decodeJwtPayload(accessToken)
    const jti = payload && typeof payload.jti === 'string' ? payload.jti : null
    const exp = payload && typeof payload.exp === 'number' ? payload.exp : null
    if (!jti || !exp || !Number.isFinite(exp)) return
    const tokenScopes =
      payload && typeof payload.scope === 'string'
        ? payload.scope.split(' ').filter(Boolean)
        : []
    await recordAccessTokenBinding(
      snapshot.accountId,
      snapshot.clientId,
      jti,
      {
        accountId: snapshot.accountId,
        clientId: snapshot.clientId,
        generation,
        scopes: tokenScopes,
      },
      new Date(exp * 1000),
    )
  } catch (error) {
    // Binding rows are a validation hint, never the exchange itself: a
    // failed write must not break an otherwise valid token response. An
    // unbound token is still accepted on a pair with no revocation history,
    // and rejected once the pair has any.
    console.warn('[oauth] failed to record grant generation:', error)
  }
}

async function extractTokenResponseBody(
  returned: unknown,
): Promise<Record<string, unknown> | null> {
  let value = returned
  if (value instanceof Response) {
    // The token endpoint answers 200 on success; anything else carries no
    // grant to bind.
    if (!value.ok) return null
    try {
      value = await value.clone().json()
    } catch {
      return null
    }
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return null
}

/** Capture the start boundary so a later concurrent revocation always wins. */
export function prepareOAuthConsent(request: Request | undefined): void {
  if (request) pendingConsentApprovals.set(request, new Date())
}

/**
 * Remember which generation was active when an authorization started. A code
 * minted by this request is stamped with that generation when it lands (see
 * `tagOAuthCodeAfterAuthorization`); stamping the start rather than the landing
 * generation is what rejects an authorization that read the old consent just
 * before a disconnect and finished writing its code after the reconnect.
 */
export async function prepareOAuthAuthorization(
  request: Request | undefined,
  accountId: string,
  clientId: string,
): Promise<void> {
  if (!request) return
  const generation = await getGrantGeneration(accountId, clientId).catch(
    () => 0,
  )
  pendingAuthorizationStarts.set(request, {
    accountId,
    clientId,
    generation,
    startedAt: new Date(),
  })
}

async function extractAuthorizationCode(
  returned: unknown,
): Promise<string | null> {
  const candidates: unknown[] = []
  if (returned instanceof Response) {
    candidates.push(returned.headers.get('location'))
    // Consent approvals answer 200 with the callback URL in the JSON body;
    // direct authorizations redirect with the code in the location header.
    try {
      const body = (await returned.clone().json()) as unknown
      if (body && typeof body === 'object') {
        const json = body as Record<string, unknown>
        candidates.push(json.url, json.redirect_uri)
      }
    } catch {
      // No JSON body; the location header above is the only candidate.
    }
  } else if (returned && typeof returned === 'object') {
    const body = returned as Record<string, unknown>
    candidates.push(body.url, body.redirect_uri)
    if (body.body && typeof body.body === 'object') {
      const inner = body.body as Record<string, unknown>
      candidates.push(inner.url, inner.redirect_uri)
    }
  }
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || !candidate) continue
    try {
      const code = new URL(candidate, 'http://localhost').searchParams.get(
        'code',
      )
      if (code) return code
    } catch {
      continue
    }
  }
  return null
}

async function readAuthorizationCodeOwner(rawCode: string): Promise<{
  identifier: string
  accountId: string
  clientId: string
} | null> {
  const identifier = storedToken(rawCode)
  const code = await prisma.verification.findFirst({
    where: { identifier, expiresAt: { gt: new Date() } },
    select: { value: true },
  })
  if (!code) return null
  const owner = parseAuthorizationCode(code.value)
  if (!owner) return null
  return { identifier, ...owner }
}

/**
 * Stamp the code this authorization just minted with its start generation, so
 * the exchange check can tell which side of a concurrent revocation the
 * authorization belongs to. Returns the code owner when a code was minted, for
 * the consent re-arm step. Safe to call when no code was minted (no-op).
 *
 * Better Auth answers direct authorizations (existing consent, no consent page)
 * with a _thrown_ redirect, which never reaches the auth after-hook. The Hono
 * auth mount calls this for those responses with the same request object the
 * before-hook captured the start boundary on.
 */
export async function tagOAuthCodeFromAuthorizeResponse(
  request: Request,
  response: Response,
): Promise<void> {
  const location = response.headers.get('location')
  if (!location || !location.includes('code=')) return
  await tagOAuthCodeAfterAuthorization(request, response)
}

export async function tagOAuthCodeAfterAuthorization(
  request: Request | undefined,
  returned: unknown,
): Promise<{ accountId: string; clientId: string } | null> {
  const start = request ? pendingAuthorizationStarts.get(request) : undefined
  if (request) pendingAuthorizationStarts.delete(request)
  const rawCode = await extractAuthorizationCode(returned)
  if (!rawCode) return null
  const code = await readAuthorizationCodeOwner(rawCode)
  if (!code) return null
  // Only a matching start boundary may stamp the code. Anything else leaves
  // the row untagged so the exchange falls back to the barrier check, which
  // stays fail-closed while a revocation is outstanding. Stamping the
  // current generation here would bless work born before a disconnect.
  if (
    start &&
    start.accountId === code.accountId &&
    start.clientId === code.clientId
  ) {
    await tagAuthorizationCodesWithGeneration(
      code.identifier,
      start.generation,
    ).catch((error) => {
      console.warn('[oauth] failed to tag authorization code:', error)
    })
  }
  return { accountId: code.accountId, clientId: code.clientId }
}

/** Install the durable barrier at the linearization point of revocation. */
export async function createOAuthRevocationBarrier(
  tx: Prisma.TransactionClient,
  accountId: string,
  clientId: string,
  revokedAt: Date,
): Promise<void> {
  const identifier = oauthRevocationBarrierIdentifier(accountId, clientId)
  await tx.verification.deleteMany({ where: { identifier } })
  await tx.verification.create({
    data: {
      id: randomUUID(),
      identifier,
      value: JSON.stringify({ type: 'spliit_oauth_revocation' }),
      createdAt: revokedAt,
      updatedAt: revokedAt,
      expiresAt: REVOCATION_BARRIER_EXPIRY,
    },
  })
}

function returnedCallbackUrl(returned: unknown): string | null {
  if (!isRecord(returned)) return null
  const body = isRecord(returned.body) ? returned.body : returned
  if (typeof body.url === 'string') return body.url
  if (typeof body.redirect_uri === 'string') return body.redirect_uri
  return null
}

/**
 * Rearm a client only after Better Auth persisted consent and issued its code.
 * Barriers newer than the start of that explicit approval are retained, so a
 * concurrent second revocation always wins. The code is stamped with the
 * generation that was active when the approval started, so a later exchange can
 * tell this fresh consent apart from work born before a disconnect.
 */
export async function rearmOAuthClientAfterConsent(
  request: Request | undefined,
  returned: unknown,
): Promise<void> {
  if (!request) return
  const consentStartedAt = pendingConsentApprovals.get(request)
  pendingConsentApprovals.delete(request)
  if (!consentStartedAt) return

  let value = returned
  if (value instanceof Response) {
    if (!value.ok) return
    try {
      value = await value.clone().json()
    } catch {
      return
    }
  }

  const callbackUrl = returnedCallbackUrl(value)
  if (!callbackUrl) return
  let rawCode: string | null
  try {
    rawCode = new URL(callbackUrl, 'http://localhost').searchParams.get('code')
  } catch {
    return
  }
  if (!rawCode) return

  const identifier = storedToken(rawCode)
  const code = await prisma.verification.findFirst({
    where: { identifier, expiresAt: { gt: new Date() } },
    select: { value: true },
  })
  if (!code) return
  const owner = parseAuthorizationCode(code.value)
  if (!owner) return

  await tagOAuthCodeAfterAuthorization(request, returned).catch((error) => {
    console.warn('[oauth] failed to tag authorization code:', error)
  })

  await prisma.verification.deleteMany({
    where: {
      identifier: oauthRevocationBarrierIdentifier(
        owner.accountId,
        owner.clientId,
      ),
      // Never clear a barrier installed after this explicit approval began.
      createdAt: { lte: consentStartedAt },
    },
  })
}

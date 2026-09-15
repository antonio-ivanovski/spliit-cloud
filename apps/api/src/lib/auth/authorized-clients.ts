import { prisma } from '@spliit/db'

import {
  deleteAccessTokenBindings,
  deleteRefreshFamilyGenerations,
  getGrantGeneration,
  incrementGrantGeneration,
  listAccessTokenBindings,
} from './oauth-grant-generation'
import { createOAuthRevocationBarrier } from './oauth-revocation-barrier'

export type AuthorizedClient = {
  consentId: string
  clientId: string
  name: string | null
  icon: string | null
  scopes: string[]
  authorizedAt: Date | null
  /**
   * Latest refresh token expiry still standing. Null means either no active
   * refresh token remains or at least one active token has no expiry.
   */
  activeUntil: Date | null
}

/**
 * OAuth clients an account has authorized, newest first.
 *
 * Consent is the durable record of "this account let this client in", so it
 * drives the list. Refresh token expiry is surfaced alongside it because that
 * is what actually decides how long the client keeps working.
 *
 * Scopes report what the client can still do, not just the latest consent row:
 * approving a narrower scope later does not shrink an older refresh grant that
 * remains valid, so the display unions the consent scopes with every
 * still-valid refresh grant. Otherwise settings would promise "read only" while
 * the app can still manage. Access-only grants (no `offline_access`, hence no
 * refresh-token row) are covered the same way through their live token
 * bindings, filtered by the current generation so revoked grants never show.
 * (Refresh rows are instead removed at disconnect; a settings read landing
 * between the generation bump and that cleanup can briefly show the old grant.
 * Exchange and bearer paths are unaffected — both already refuse it.)
 */
export async function listAuthorizedClients(
  accountId: string,
): Promise<AuthorizedClient[]> {
  const consents = await prisma.oauthConsent.findMany({
    where: { userId: accountId },
    include: { oauthClient: { select: { name: true, icon: true } } },
    orderBy: { createdAt: 'desc' },
  })
  if (consents.length === 0) return []

  const now = new Date()
  const refreshTokens = await prisma.oauthRefreshToken.findMany({
    where: {
      userId: accountId,
      clientId: { in: consents.map((consent) => consent.clientId) },
      revoked: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: { clientId: true, expiresAt: true, scopes: true },
  })

  const activeUntil = new Map<string, Date | null>()
  const liveGrantScopes = new Map<string, Set<string>>()
  const trackGrant = (
    clientId: string,
    expiresAt: Date | null,
    scopes: Iterable<string>,
  ) => {
    if (expiresAt && expiresAt <= now) return
    if (!activeUntil.has(clientId)) {
      activeUntil.set(clientId, expiresAt)
    } else {
      const current = activeUntil.get(clientId)
      // A null expiry is unbounded and therefore wins over every dated token.
      if (current !== null) {
        if (expiresAt === null || expiresAt > current!) {
          activeUntil.set(clientId, expiresAt)
        }
      }
    }
    let grantScopes = liveGrantScopes.get(clientId)
    if (!grantScopes) {
      grantScopes = new Set<string>()
      liveGrantScopes.set(clientId, grantScopes)
    }
    for (const scope of scopes) grantScopes.add(scope)
  }
  for (const token of refreshTokens) {
    // Keep this defensive check as well as the database filter so an expiry at
    // the query boundary can never be presented as active.
    trackGrant(token.clientId, token.expiresAt, token.scopes ?? [])
  }
  for (const consent of consents) {
    const current = await getGrantGeneration(accountId, consent.clientId)
    const bindings = await listAccessTokenBindings(accountId, consent.clientId)
    for (const binding of bindings) {
      if (binding.generation !== current) continue
      trackGrant(consent.clientId, binding.expiresAt, binding.scopes)
    }
  }
  return consents.map((consent) => ({
    consentId: consent.id,
    clientId: consent.clientId,
    name: consent.oauthClient?.name ?? null,
    icon: consent.oauthClient?.icon ?? null,
    scopes: Array.from(
      new Set([
        ...consent.scopes,
        ...(liveGrantScopes.get(consent.clientId) ?? []),
      ]),
    ),
    authorizedAt: consent.createdAt,
    activeUntil: activeUntil.get(consent.clientId) ?? null,
  }))
}

export type RevokeResult = {
  refreshTokensRevoked: number
  accessTokensDeleted: number
  authorizationCodesDeleted: number
}

function authorizationCodeBelongsTo(
  value: string,
  accountId: string,
  clientId: string,
): boolean {
  try {
    const parsed = JSON.parse(value) as {
      type?: unknown
      userId?: unknown
      query?: { client_id?: unknown }
    }
    return (
      parsed.type === 'authorization_code' &&
      parsed.userId === accountId &&
      parsed.query?.client_id === clientId
    )
  } catch {
    return false
  }
}

/**
 * Withdraw an account's authorization for one OAuth client.
 *
 * Deleting the consent row is not enough on its own: the plugin's own
 * `delete-consent` endpoint stops there, which leaves a client refreshing
 * happily for the remaining lifetime of its refresh token. Revoking the refresh
 * tokens is what actually ends access. Pending authorization codes must also be
 * removed: otherwise a code issued just before revocation could be exchanged
 * afterwards and create a fresh refresh-token family. A durable revocation
 * barrier closes the remaining race where code creation or token rotation
 * started before cleanup but writes its result afterwards. Cleanup records go
 * together in a transaction after that barrier has committed.
 *
 * Access tokens are JWTs verified against the JWKS rather than looked up, so
 * bearer validation additionally binds each issued token to the authorization
 * generation (see `oauth-grant-generation`). Disconnect moves the pair to the
 * next generation, which rejects already-issued access tokens on their next use
 * across every API replica.
 */
export async function revokeAuthorizedClient({
  accountId,
  consentId,
}: {
  accountId: string
  consentId: string
}): Promise<RevokeResult | null> {
  const consent = await prisma.oauthConsent.findUnique({
    where: { id: consentId },
    select: { id: true, userId: true, clientId: true },
  })
  // Same shape for "missing" and "someone else's" so the caller cannot probe
  // for consent ids belonging to other accounts.
  if (!consent || consent.userId !== accountId) return null

  const revokedAt = new Date()
  // Commit the barrier first. If it shared the cleanup transaction, a token
  // request could run after the sweep but before commit, observe neither the
  // barrier nor the cleanup, and leave a newly-issued family behind. A failed
  // second transaction intentionally leaves this fail-closed barrier standing
  // so retrying the revocation is safe. The generation moves forward right
  // after, in its own retried transaction, so already-issued access tokens
  // and paused authorizations stay distinguishable from the next grant after
  // reconnect.
  await prisma.$transaction(async (tx) => {
    await createOAuthRevocationBarrier(
      tx,
      accountId,
      consent.clientId,
      revokedAt,
    )
  })
  await incrementGrantGeneration(accountId, consent.clientId)

  return prisma.$transaction(async (tx) => {
    // Better Auth does not enforce uniqueness for (userId, clientId). Remove
    // every duplicate so none can silently authorize the client afterwards.
    await tx.oauthConsent.deleteMany({
      where: { userId: accountId, clientId: consent.clientId },
    })

    const pendingCodes = await tx.verification.findMany({
      where: {
        expiresAt: { gt: revokedAt },
        AND: [
          { value: { contains: '"type":"authorization_code"' } },
          { value: { contains: JSON.stringify(accountId) } },
          { value: { contains: JSON.stringify(consent.clientId) } },
        ],
      },
      select: { id: true, value: true },
    })
    const authorizationCodeIds = pendingCodes
      .filter((code) =>
        authorizationCodeBelongsTo(code.value, accountId, consent.clientId),
      )
      .map((code) => code.id)
    const authorizationCodes = authorizationCodeIds.length
      ? await tx.verification.deleteMany({
          where: { id: { in: authorizationCodeIds } },
        })
      : { count: 0 }
    const refreshed = await tx.oauthRefreshToken.updateMany({
      where: {
        userId: accountId,
        clientId: consent.clientId,
        revoked: null,
      },
      data: { revoked: revokedAt },
    })
    // Forget the revoked families' generation bindings: the refresh rows
    // above are dead, so their family rows would otherwise linger forever
    // (they never expire by design). Families are keyed by authorization code
    // id, which the refresh rows carry.
    const revokedFamilies =
      (await tx.oauthRefreshToken.findMany({
        where: { userId: accountId, clientId: consent.clientId },
        select: { authorizationCodeId: true },
      })) ?? []
    await deleteRefreshFamilyGenerations(
      tx,
      revokedFamilies.flatMap((token) =>
        token.authorizationCodeId ? [token.authorizationCodeId] : [],
      ),
    )
    // Drop this grant's token bindings too: they expire with their tokens
    // anyway, but leaving them would show revoked scopes until then.
    await deleteAccessTokenBindings(tx, accountId, consent.clientId)
    await tx.oauthRefreshToken.updateMany({
      where: {
        userId: accountId,
        clientId: consent.clientId,
        rotationReplayResponse: { not: null },
      },
      data: {
        rotationReplayResponse: null,
        rotationReplayExpiresAt: null,
      },
    })
    const access = await tx.oauthAccessToken.deleteMany({
      where: { userId: accountId, clientId: consent.clientId },
    })
    return {
      refreshTokensRevoked: refreshed.count,
      accessTokensDeleted: access.count,
      authorizationCodesDeleted: authorizationCodes.count,
    }
  })
}

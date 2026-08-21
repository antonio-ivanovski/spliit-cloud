import { prisma } from '@spliit/db'

export type AuthorizedClient = {
  consentId: string
  clientId: string
  name: string | null
  icon: string | null
  scopes: string[]
  authorizedAt: Date | null
  /** Latest refresh token expiry still standing, null when none remain. */
  activeUntil: Date | null
}

/**
 * OAuth clients an account has authorized, newest first.
 *
 * Consent is the durable record of "this account let this client in", so it
 * drives the list. Refresh token expiry is surfaced alongside it because that
 * is what actually decides how long the client keeps working.
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

  const refreshTokens = await prisma.oauthRefreshToken.findMany({
    where: {
      userId: accountId,
      clientId: { in: consents.map((consent) => consent.clientId) },
      revoked: null,
    },
    select: { clientId: true, expiresAt: true },
  })

  const activeUntil = new Map<string, Date | null>()
  for (const token of refreshTokens) {
    const current = activeUntil.get(token.clientId)
    if (!current || (token.expiresAt && token.expiresAt > current)) {
      activeUntil.set(token.clientId, token.expiresAt)
    }
  }

  return consents.map((consent) => ({
    consentId: consent.id,
    clientId: consent.clientId,
    name: consent.oauthClient?.name ?? null,
    icon: consent.oauthClient?.icon ?? null,
    scopes: consent.scopes,
    authorizedAt: consent.createdAt,
    activeUntil: activeUntil.get(consent.clientId) ?? null,
  }))
}

export type RevokeResult = {
  refreshTokensRevoked: number
  accessTokensDeleted: number
}

/**
 * Withdraw an account's authorization for one OAuth client.
 *
 * Deleting the consent row is not enough on its own: the plugin's own
 * `delete-consent` endpoint stops there, which leaves a client refreshing
 * happily for the remaining lifetime of its refresh token. Revoking the refresh
 * tokens is what actually ends access, so all three go together in a
 * transaction.
 *
 * Access tokens are JWTs verified against the JWKS rather than looked up, so a
 * token already in flight stays valid until it expires. That window is one
 * hour, and callers should say so rather than promise instant cutoff.
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

  return prisma.$transaction(async (tx) => {
    const refreshed = await tx.oauthRefreshToken.updateMany({
      where: {
        userId: accountId,
        clientId: consent.clientId,
        revoked: null,
      },
      data: { revoked: new Date() },
    })
    const access = await tx.oauthAccessToken.deleteMany({
      where: { userId: accountId, clientId: consent.clientId },
    })
    await tx.oauthConsent.delete({ where: { id: consent.id } })
    return {
      refreshTokensRevoked: refreshed.count,
      accessTokensDeleted: access.count,
    }
  })
}

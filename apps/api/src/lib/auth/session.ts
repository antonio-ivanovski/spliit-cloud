import { prisma } from '@spliit/db'
import { auth } from './index'

export type ResolvedAuth = NonNullable<
  Awaited<ReturnType<typeof auth.api.getSession>>
>

/**
 * Resolve the authenticated account (and its better-auth session) for a given
 * request. Returns `null` when the request is unauthenticated or the session
 * is no longer valid. Account is eagerly refreshed from the database so that
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

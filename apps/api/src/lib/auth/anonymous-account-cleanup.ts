import { prisma, type Prisma } from '@spliit/db'

export const UNACKNOWLEDGED_ANONYMOUS_ACCOUNT_RETENTION_MS =
  7 * 24 * 60 * 60 * 1000
const CLEANUP_BATCH_SIZE = 100

function eligibleAnonymousAccounts(cutoff: Date): Prisma.AccountWhereInput {
  return {
    isAnonymous: true,
    anonymousRecoveryCredential: {
      is: {
        acknowledgedAt: null,
        createdAt: { lte: cutoff },
      },
    },
  }
}

/**
 * Delete anonymous accounts that never completed recovery-link onboarding.
 *
 * Candidates are selected in bounded pages, then the complete eligibility
 * predicate is repeated in the delete. An account acknowledged between those
 * operations therefore survives the sweep. Account cascades remove its pending
 * recovery credential and Better Auth sessions.
 */
export async function runAnonymousAccountCleanup(
  now = new Date(),
): Promise<{ deleted: number }> {
  const cutoff = new Date(
    now.getTime() - UNACKNOWLEDGED_ANONYMOUS_ACCOUNT_RETENTION_MS,
  )
  const where = eligibleAnonymousAccounts(cutoff)
  let deleted = 0

  for (;;) {
    const candidates = await prisma.account.findMany({
      where,
      select: { id: true },
      orderBy: { id: 'asc' },
      take: CLEANUP_BATCH_SIZE,
    })
    if (candidates.length === 0) break

    const result = await prisma.account.deleteMany({
      where: {
        ...where,
        id: { in: candidates.map(({ id }) => id) },
      },
    })
    deleted += result.count
    if (candidates.length < CLEANUP_BATCH_SIZE) break
  }

  return { deleted }
}

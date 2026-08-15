import { prisma, type Account } from '@spliit/db'

const ACCOUNT_CACHE_TTL_MS = 30_000
const ACCOUNT_CACHE_MAX_SIZE = 1024

export type CachedAccount = Account & {
  anonymousOnboardingCompleted: boolean
}

export function isAnonymousSetupIncomplete(user: {
  isAnonymous?: boolean | null
  anonymousOnboardingCompleted?: boolean | null
}): boolean {
  return user.isAnonymous === true && user.anonymousOnboardingCompleted !== true
}

function withAnonymousOnboarding(
  account: Account,
  recovery?: {
    acknowledgedAt: Date | null
    onboardingCompletedAt: Date | null
  } | null,
): CachedAccount {
  return {
    ...account,
    anonymousOnboardingCompleted:
      account.isAnonymous !== true ||
      (recovery?.acknowledgedAt != null &&
        recovery.onboardingCompletedAt != null),
  }
}

/**
 * Per-request generation token. {@link getCachedAccount} captures it before
 * hitting the DB and re-checks after the await; if
 * {@link invalidateAccountCache} ran in between, the captured generation no
 * longer matches and the freshly-fetched row is discarded instead of
 * overwriting the cache with stale data.
 *
 * Without this guard an in-flight fetch started before invalidation can `set`
 * the old Account row back into the cache and serve it (wrong email / name) for
 * up to TTL_MS.
 */
let accountCacheGeneration = 0

type CacheEntry = {
  account: CachedAccount
  expiresAt: number
  generation: number
}

const accountCache = new Map<string, CacheEntry>()

export async function getCachedAccount(accountId: string) {
  const now = Date.now()
  const cached = accountCache.get(accountId)
  if (cached && cached.expiresAt > now) return cached.account
  if (cached) accountCache.delete(accountId)

  const generationAtFetchStart = accountCacheGeneration
  const account = await prisma.account.findUnique({ where: { id: accountId } })
  if (!account) return null

  const recovery = account.isAnonymous
    ? await prisma.anonymousRecoveryCredential.findUnique({
        where: { accountId: account.id },
        select: { acknowledgedAt: true, onboardingCompletedAt: true },
      })
    : null
  const result = withAnonymousOnboarding(account, recovery)

  // A concurrent invalidateAccountCache (or clearAccountCache) bumped the
  // generation while we were awaiting the DB. Skip the write so we don't
  // poison the cache with the row we're about to invalidate.
  if (generationAtFetchStart !== accountCacheGeneration) return result

  if (accountCache.size >= ACCOUNT_CACHE_MAX_SIZE) {
    const oldestAccountId = accountCache.keys().next().value
    if (oldestAccountId) accountCache.delete(oldestAccountId)
  }
  accountCache.set(accountId, {
    account: result,
    expiresAt: now + ACCOUNT_CACHE_TTL_MS,
    generation: accountCacheGeneration,
  })
  return result
}

export function invalidateAccountCache(accountId: string) {
  accountCacheGeneration += 1
  accountCache.delete(accountId)
}

export function clearAccountCache() {
  accountCacheGeneration += 1
  accountCache.clear()
}

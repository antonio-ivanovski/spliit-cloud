import { needsAnonymousOnboarding, needsDisplayName } from '@/lib/account'
import { useCurrentAccount } from '@/lib/use-current-account'
import { trpc } from '@/trpc/client'

/**
 * First-run setup state with an authoritative anonymous flag.
 *
 * The session user never carries `anonymousOnboardingCompleted` (it is computed
 * server-side, not a column), so the name-fallback in
 * `needsAnonymousOnboarding` mistakes a named-but-unsafeguarded guest for a
 * finished account — routing it out of `complete-profile` into 412s. This hook
 * prefers the gate-exempt `account.onboardingStatus` query and only falls back
 * to the session predicate while the query is unresolved or has errored
 * (offline included: failing open preserves the old behavior and self-heals on
 * reconnect when the query succeeds and the gates bounce).
 */
export function useOnboardingStatus() {
  const {
    data: account,
    isPending,
    isRefetching,
    error,
    refetch,
  } = useCurrentAccount()
  const statusQuery = trpc.account.onboardingStatus.useQuery(undefined, {
    enabled: account?.isAnonymous === true,
  })

  // Exact completion when the server has spoken (or the account object
  // carries an embedded flag, e.g. `me`-shaped rows); otherwise unknown.
  const completed =
    statusQuery.data?.anonymousOnboardingCompleted ??
    account?.anonymousOnboardingCompleted ??
    null

  const needsProfile = account != null && needsDisplayName(account)
  const needsSafeguard =
    account?.isAnonymous === true &&
    (completed === true
      ? false
      : completed === false
        ? true
        : needsAnonymousOnboarding(account))

  return {
    account,
    isPending,
    isRefetching,
    error,
    refetch,
    needsProfile,
    needsSafeguard,
    needsOnboarding: needsProfile || needsSafeguard,
    // `isPending` alone is also true for a disabled query with no data (a
    // named non-anonymous account would spin forever), so require an actual
    // fetch in flight. Background refetches never set `isPending`.
    statusPending: statusQuery.isPending && statusQuery.isFetching,
    refetchStatus: statusQuery.refetch,
  }
}

export type UseOnboardingStatusResult = ReturnType<typeof useOnboardingStatus>

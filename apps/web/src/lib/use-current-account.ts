import type { AuthAccount } from '@/lib/auth'
import { authClient } from '@/lib/auth'
import {
  clearStoredAccountSnapshot,
  getStoredAccountSnapshot,
  storeConfirmedAccount,
} from '@/trpc/query-persistence'
import { useEffect } from 'react'

export type AccountSource = 'network' | 'cache' | 'none'

type SessionState = ReturnType<typeof authClient.useSession>

export type UseCurrentAccountResult = {
  data: AuthAccount | null
  isPending: boolean
  isRefetching: boolean
  error: SessionState['error']
  refetch: SessionState['refetch']
  /** Optional for compatibility with existing consumers that mock this hook. */
  source?: AccountSource
}

/**
 * Resolve the current signed-in account. Wraps better-auth's `useSession`
 * so the rest of the app has a single, stable hook to consume.
 *
 * Returns `null` for `data` when there is no session or while the session
 * is still being resolved for the first time. Use `isPending` to
 * distinguish "loading" from "signed out".
 *
 * `data` is the `Account` row (better-auth "user"), not the full
 * `{ user, session }` envelope.
 */
export function useCurrentAccount(): UseCurrentAccountResult {
  const session = authClient.useSession()
  const networkAccount = session.data?.user ?? null
  const unauthorized = session.error?.status === 401
  const browserOffline =
    typeof navigator !== 'undefined' && navigator.onLine === false
  const canUseCachedAccount =
    !networkAccount &&
    !unauthorized &&
    (browserOffline || (!session.isPending && Boolean(session.error)))
  const storedSnapshot = canUseCachedAccount ? getStoredAccountSnapshot() : null
  const cachedAccount =
    (storedSnapshot?.account as AuthAccount | undefined) ?? null

  // Only successful session responses are allowed to refresh the snapshot.
  // A 401 is an authoritative sign-out and must remove it; transient errors
  // deliberately leave it available for a read-only offline view.
  useEffect(() => {
    if (networkAccount && !session.error) {
      storeConfirmedAccount(networkAccount)
    } else if (
      !session.isPending &&
      (unauthorized || (!session.error && !networkAccount))
    ) {
      clearStoredAccountSnapshot()
    }
  }, [networkAccount, session.error, session.isPending, unauthorized])

  return {
    data: networkAccount ?? cachedAccount,
    isPending: session.isPending && !cachedAccount,
    isRefetching: session.isRefetching,
    error: session.error,
    refetch: session.refetch,
    source: networkAccount ? 'network' : cachedAccount ? 'cache' : 'none',
  }
}

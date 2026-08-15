import { useEffect } from 'react'

import { authClient } from '@/lib/auth'
import type { AuthAccount } from '@/lib/auth'
import {
  clearLastAccount,
  readLastAccount,
  writeLastAccount,
} from '@/lib/last-account'
import { isNetworkError } from '@/lib/network-error'

/**
 * Resolve the current signed-in account. Wraps better-auth's `useSession` so
 * the rest of the app has a single, stable hook to consume.
 *
 * Returns `null` for `data` when there is no session or while the session is
 * still being resolved for the first time. Use `isPending` to distinguish
 * "loading" from "signed out".
 *
 * When `get-session` fails because the device is offline, the last account from
 * this tab is kept so RequireAuth does not dump the user on the sign-in
 * landing.
 *
 * `data` is the `Account` row (better-auth "user"), not the full `{ user,
 * session }` envelope.
 */
export function useCurrentAccount() {
  const session = authClient.useSession()
  const live = (session.data?.user as AuthAccount | undefined) ?? null

  useEffect(() => {
    if (live) {
      writeLastAccount(live)
      return
    }
    if (!session.isPending && !isNetworkError(session.error)) {
      clearLastAccount()
    }
  }, [live, session.error, session.isPending])

  const data =
    live ?? (isNetworkError(session.error) ? readLastAccount() : null)

  return {
    data,
    isPending: session.isPending,
    isRefetching: session.isRefetching,
    error: session.error,
    refetch: session.refetch,
  }
}

export type UseCurrentAccountResult = ReturnType<typeof useCurrentAccount>

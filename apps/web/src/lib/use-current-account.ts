import { useEffect } from 'react'

import { authClient } from '@/lib/auth'
import type { AuthAccount } from '@/lib/auth'
import {
  clearLastAccount,
  readLastAccount,
  writeLastAccount,
} from '@/lib/last-account'

/**
 * Resolve the current signed-in account. Wraps better-auth's `useSession` so
 * the rest of the app has a single, stable hook to consume.
 *
 * The HTTP-only session cookie is the credential. This hook also hydrates a
 * device-scoped account snapshot (`spliit:last-account`) so the shell can stay
 * signed-in on a PWA cold start before `get-session` returns, or when that call
 * fails offline. The snapshot is id/name/email/image/flags only — not a token.
 *
 * Confirmed signed-out (`data: null`, `error: null`) clears the snapshot. A
 * leftover cache may flash the dashboard until `get-session` returns; that is
 * accepted for offline-first.
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
    } else if (!session.isPending && !session.error) {
      clearLastAccount()
    }
  }, [live, session.error, session.isPending])

  const cached = readLastAccount()
  const data = live ?? (session.isPending || session.error ? cached : null)

  return {
    data,
    isPending: session.isPending,
    isRefetching: session.isRefetching,
    error: session.error,
    refetch: session.refetch,
  }
}

export type UseCurrentAccountResult = ReturnType<typeof useCurrentAccount>

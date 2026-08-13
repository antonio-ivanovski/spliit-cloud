import { authClient } from '@/lib/auth'
import type { AuthAccount } from '@/lib/auth'

/**
 * Resolve the current signed-in account. Wraps better-auth's `useSession` so
 * the rest of the app has a single, stable hook to consume.
 *
 * Returns `null` for `data` when there is no session or while the session is
 * still being resolved for the first time. Use `isPending` to distinguish
 * "loading" from "signed out".
 *
 * `data` is the `Account` row (better-auth "user"), not the full `{ user,
 * session }` envelope.
 */
export function useCurrentAccount() {
  const session = authClient.useSession()
  return {
    data: (session.data?.user as AuthAccount | undefined) ?? null,
    isPending: session.isPending,
    isRefetching: session.isRefetching,
    error: session.error,
    refetch: session.refetch,
  }
}

export type UseCurrentAccountResult = ReturnType<typeof useCurrentAccount>

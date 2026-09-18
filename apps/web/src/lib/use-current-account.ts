import { useEffect } from 'react'

import { authClient } from '@/lib/auth'
import type { AuthAccount } from '@/lib/auth'
import {
  clearLastAccount,
  readLastAccount,
  writeLastAccount,
} from '@/lib/last-account'
import {
  useOfflineSession,
  useOptionalOfflineLifecycle,
} from '@/lib/offline/provider'

/**
 * Resolve the current signed-in account. Wraps better-auth's `useSession` so
 * the rest of the app has a single, stable hook to consume.
 *
 * When the offline lifecycle provider is mounted, identity comes from its
 * single owner (last-account writes/clears happen there; stale hook data cannot
 * repopulate after cross-tab invalidation — only a fresh verified session
 * writes). The shape stays `{ data, isPending, isRefetching, error, refetch }`
 * so consumers are unchanged.
 *
 * Outside the provider (isolated unit tests), falls back to the legacy hook +
 * last-account snapshot behavior.
 *
 * The HTTP-only session cookie is the credential. The device snapshot is
 * id/name/email/image/flags only — not a token.
 */
export function useCurrentAccount() {
  const lifecycle = useOptionalOfflineLifecycle()
  const session = authClient.useSession()
  const live = (session.data?.user as AuthAccount | undefined) ?? null
  // Always subscribed (stable, no second latch): ignored outside the provider.
  const offline = useOfflineSession()

  useEffect(() => {
    // Single owner: when the lifecycle is present it owns last-account
    // writes/clears (including invalidation fencing). Skip the legacy effect
    // so stale hook data cannot repopulate after a cross-tab revoke.
    if (lifecycle) return
    if (live) {
      writeLastAccount(live)
    } else if (!session.isPending && !session.error) {
      clearLastAccount()
    }
  }, [live, session.error, session.isPending, lifecycle])

  useEffect(() => {
    // P1-1: 401/UNAUTHORIZED session failures trigger verification.
    // FORBIDDEN is excluded inside notifyAuthError (group permission).
    if (!lifecycle) return
    if (session.error) {
      try {
        lifecycle.notifyAuthError(session.error)
      } catch {
        // Notification must never break rendering.
      }
    }
  }, [lifecycle, session.error])

  if (lifecycle) {
    // Bounded bootstrap: `checking` resolves via the lifecycle's 8s-bound
    // verification — RequireAuth never blocks on an unbounded hook wait.
    // `offline-identity` still renders cached reads; only `verified` gates
    // future writes (gated on verified session).
    const isPending = offline.session === 'checking'
    return {
      data: offline.account,
      isPending,
      isRefetching: isPending ? false : session.isRefetching,
      error: session.error,
      refetch: () => lifecycle.verifySession().then(() => session.refetch()),
    }
  }

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

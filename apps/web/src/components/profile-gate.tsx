import { Navigate, useRouterState } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import type { PropsWithChildren } from 'react'

import { needsAccountOnboarding } from '@/lib/account'
import { readLastAccount } from '@/lib/last-account'
import { useCurrentAccount } from '@/lib/use-current-account'
import { useOnlineStatus } from '@/lib/use-online-status'

const ungatedPaths = new Set([
  '/auth/complete-profile',
  '/auth/recover',
  '/privacy',
  '/terms',
  '/imprint',
  '/unsubscribe',
])

/**
 * Global guard that ensures authenticated users finish first-run setup (display
 * name, and for anonymous accounts the recovery link) on every route.
 *
 * Unlike `RequireAuth`, which only wraps specific protected routes, this gate
 * runs at the root shell level and catches ALL routes — including the public
 * homepage (`/`). The complete-profile and legal-information routes are
 * excluded so people can always read them.
 *
 * Signed-out visitors pass through unchanged.
 */
export function ProfileGate({ children }: PropsWithChildren) {
  const { data: account, isPending } = useCurrentAccount()
  const isOnline = useOnlineStatus()
  const routerState = useRouterState()
  const currentPath = routerState.location.pathname

  if (isPending) {
    // Signed-out offline visitors should see the public homepage (and legal
    // pages) instead of waiting on get-session. Keep the spinner when a
    // previous tab session might still restore.
    if (!isOnline && !account && !readLastAccount()) {
      return <>{children}</>
    }
    return (
      <div className="flex flex-1 items-center justify-center py-10">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  // Not signed in — nothing to gate
  if (!account) {
    return <>{children}</>
  }

  if (ungatedPaths.has(currentPath)) {
    return <>{children}</>
  }

  // Signed in but missing display name or anonymous recovery setup
  if (needsAccountOnboarding(account)) {
    const target =
      typeof window !== 'undefined'
        ? `${currentPath}${window.location.search}${window.location.hash}`
        : currentPath
    return (
      <Navigate
        to="/auth/complete-profile"
        search={{ redirect: target }}
        replace
      />
    )
  }

  return <>{children}</>
}

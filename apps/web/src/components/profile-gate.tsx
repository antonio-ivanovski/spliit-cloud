import { Navigate, useRouterState } from '@tanstack/react-router'
import type { PropsWithChildren } from 'react'

import { needsAccountOnboarding } from '@/lib/account'
import { useCurrentAccount } from '@/lib/use-current-account'

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
  const { data: account } = useCurrentAccount()
  const routerState = useRouterState()
  const currentPath = routerState.location.pathname

  // Not signed in — nothing to gate. Cached accounts already appear on
  // `data` while get-session is pending, so a spinner here would hide the
  // signed-in shell. Signed-out cold starts may flash AuthPanel.
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

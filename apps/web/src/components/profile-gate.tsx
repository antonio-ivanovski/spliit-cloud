import { Navigate, useRouterState } from '@tanstack/react-router'
import type { PropsWithChildren } from 'react'

import { useOnboardingStatus } from '@/lib/use-onboarding-status'

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
 *
 * Onboarding state comes from `useOnboardingStatus`: the session user cannot
 * see the server's safeguard flag, so a named-but-unsafeguarded guest would
 * otherwise sail through on its display name alone. While that status is
 * unresolved the session predicate decides (fail open, self-heals).
 */
export function ProfileGate({ children }: PropsWithChildren) {
  const { account, needsOnboarding } = useOnboardingStatus()
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
  if (needsOnboarding) {
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

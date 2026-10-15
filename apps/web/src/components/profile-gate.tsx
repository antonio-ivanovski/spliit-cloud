import { Navigate, useRouterState } from '@tanstack/react-router'
import { createContext, type PropsWithChildren } from 'react'

import { useOnboardingStatus } from '@/lib/use-onboarding-status'

/**
 * Marks routes rendered inside {@link ProfileGate} so the inner
 * {@link RequireAuth} can defer its own complete-profile redirect to this outer
 * gate (single redirect owner when nested; standalone renders still redirect on
 * their own).
 */
export const ProfileGateContext = createContext(false)

const ungatedPaths = new Set([
  '/auth/complete-profile',
  '/auth/recover',
  '/auth/forgot-password',
  '/auth/reset-password',
  '/oauth/login',
  '/oauth/consent',
  '/oauth/manual-callback',
  '/privacy',
  '/delete-account',
  '/terms',
  '/imprint',
  '/support',
  '/unsubscribe',
])

function stripRedirectParam(search: string): string {
  try {
    const params = new URLSearchParams(
      search.startsWith('?') ? search.slice(1) : search,
    )
    params.delete('redirect')
    const rest = params.toString()
    return rest ? `?${rest}` : ''
  } catch {
    return search
  }
}

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
  const { account, isPending, statusPending, needsProfile, needsOnboarding } =
    useOnboardingStatus()
  const routerState = useRouterState()
  const currentPath = routerState.location.pathname

  // Not signed in — nothing to gate. Cached accounts already appear on
  // `data` while get-session is pending, so a spinner here would hide the
  // signed-in shell. Signed-out cold starts may flash AuthPanel.
  if (!account) {
    return (
      <ProfileGateContext.Provider value={true}>
        <>{children}</>
      </ProfileGateContext.Provider>
    )
  }

  if (ungatedPaths.has(currentPath)) {
    return (
      <ProfileGateContext.Provider value={true}>
        <>{children}</>
      </ProfileGateContext.Provider>
    )
  }

  // Fail closed while the onboarding verdict is unresolved: a named session
  // alone cannot prove the anonymous safeguard finished, so neither render
  // children (fail-open flash) nor Navigate (redirect on stale data) here.
  // Nameless accounts already prove they need setup from the cached row, so
  // they still redirect below instead of holding.
  const anonymousStatusPending = statusPending && account.isAnonymous === true
  const namedSessionPending =
    isPending && !needsProfile && account.isAnonymous === true
  if (anonymousStatusPending || namedSessionPending) {
    return null
  }

  // Signed in but missing display name or anonymous recovery setup
  if (needsOnboarding) {
    const location = routerState.location as {
      searchStr?: string
      hash?: string
    }
    const searchStr =
      location.searchStr ??
      (typeof window !== 'undefined' ? window.location.search : '')
    const hash =
      location.hash ??
      (typeof window !== 'undefined' ? window.location.hash : '')
    // Strip any existing `redirect` param so a re-gated complete-profile
    // bounce cannot nest (`?redirect=/auth/complete-profile?redirect=…`).
    const target = `${currentPath}${stripRedirectParam(searchStr)}${hash}`
    return (
      <Navigate
        to="/auth/complete-profile"
        search={{ redirect: target }}
        replace
      />
    )
  }

  return (
    <ProfileGateContext.Provider value={true}>
      <>{children}</>
    </ProfileGateContext.Provider>
  )
}

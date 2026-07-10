import { needsDisplayName } from '@/lib/account'
import { useCurrentAccount } from '@/lib/use-current-account'
import { Navigate, useRouterState } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import type { PropsWithChildren } from 'react'

const ungatedPaths = new Set([
  '/auth/complete-profile',
  '/privacy',
  '/terms',
  '/imprint',
])

/**
 * Global guard that ensures authenticated users with missing display names
 * are redirected to the complete-profile page on every route.
 *
 * Unlike `RequireAuth`, which only wraps specific protected routes, this
 * gate runs at the root shell level and catches ALL routes — including the
 * public homepage (`/`). The complete-profile and legal-information routes
 * are excluded so people can always read them.
 *
 * Signed-out visitors pass through unchanged.
 */
export function ProfileGate({ children }: PropsWithChildren) {
  const { data: account, isPending } = useCurrentAccount()
  const routerState = useRouterState()
  const currentPath = routerState.location.pathname

  if (isPending) {
    return (
      <div className="flex-1 flex items-center justify-center py-10">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
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

  // Signed in but missing display name — redirect to complete-profile
  if (needsDisplayName(account)) {
    const target =
      typeof window !== 'undefined'
        ? `${currentPath}${window.location.search}`
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

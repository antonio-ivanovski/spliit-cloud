import { needsDisplayName } from '@/lib/account'
import { useCurrentAccount } from '@/lib/use-current-account'
import { Navigate } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import type { PropsWithChildren } from 'react'

function currentPathWithSearch(): string {
  if (typeof window === 'undefined') return '/'
  return `${window.location.pathname}${window.location.search}${window.location.hash}`
}

/**
 * Route guard. Shows a loader while the session is being resolved, redirects
 * unauthenticated users to `/` (preserving the original target in
 * a `redirect` query parameter), and otherwise renders the protected content.
 */
export function RequireAuth({ children }: PropsWithChildren) {
  const { data: account, isPending } = useCurrentAccount()

  if (isPending) {
    return (
      <div className="flex-1 flex items-center justify-center py-10">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!account) {
    return (
      <Navigate to="/" search={{ redirect: currentPathWithSearch() }} replace />
    )
  }

  if (needsDisplayName(account)) {
    const target = currentPathWithSearch()
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

import { Navigate } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import type { PropsWithChildren } from 'react'

import { needsDisplayName } from '@/lib/account'
import { useCurrentAccount } from '@/lib/use-current-account'

function currentPathWithSearch(): string {
  if (typeof window === 'undefined') return '/'
  return `${window.location.pathname}${window.location.search}${window.location.hash}`
}

function hasGroupViewerCredential(): boolean {
  if (typeof window === 'undefined') return false
  const search = new URLSearchParams(window.location.search)
  return Boolean(search.get('viewKey') || search.get('invite'))
}

/**
 * Route guard. Shows a loader while the session is being resolved, redirects
 * unauthenticated users to `/` (preserving the original target in a `redirect`
 * query parameter), and otherwise renders the protected content.
 *
 * Anonymous visitors may enter `/groups/:id` only when the URL carries a
 * retained `viewKey` or `invite` search param. Everyone else is sent through
 * sign-in so members without a public/invite link are not stranded on a
 * dead-end unauthorized page.
 */
export function RequireAuth({ children }: PropsWithChildren) {
  const { data: account, isPending } = useCurrentAccount()
  const permitsGroupViewer =
    typeof window !== 'undefined' &&
    /^\/groups\/(?!create(?:\/|$)|import(?:\/|$)|bulk-categorize(?:\/|$))[^/]+(?:\/|$)/.test(
      window.location.pathname,
    ) &&
    hasGroupViewerCredential()

  if (isPending) {
    return (
      <div className="flex flex-1 items-center justify-center py-10">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!account) {
    if (permitsGroupViewer) return <>{children}</>
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

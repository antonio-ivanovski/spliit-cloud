import { Navigate } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import { useContext, type PropsWithChildren } from 'react'

import { ApiErrorEmptyState } from '@/components/api-error-empty-state'
import { OfflineEmptyState } from '@/components/offline-empty-state'
import { buildAuthBounceSearch } from '@/lib/signup-invite'
import { useOnboardingStatus } from '@/lib/use-onboarding-status'
import {
  useOfflineWithoutData,
  useServerUnreachableWithoutData,
} from '@/lib/use-online-status'

import { ProfileGateContext } from './profile-gate'

function currentBounceSearch(): Record<string, string> {
  if (typeof window === 'undefined') return {}
  // Pass the full current location: the builder lifts credentials (top-level
  // or nested in a legacy `redirect=`) and drops the nesting, so a re-gated
  // bounce can never re-nest (`?redirect=/auth/complete-profile?redirect=…`).
  return buildAuthBounceSearch({
    writer: 'RequireAuth',
    from: `${window.location.pathname}${window.location.search}${window.location.hash}`,
  })
}

function hasGroupViewerCredential(): boolean {
  if (typeof window === 'undefined') return false
  const search = new URLSearchParams(window.location.search)
  return Boolean(search.get('viewKey') || search.get('invite'))
}

/**
 * Route guard. Shows a loader only while the bounded session verification is
 * unresolved and there is no cached account, redirects unauthenticated users to
 * `/` (preserving the original target in a `redirect` query parameter), and
 * otherwise renders the protected content.
 *
 * Session bootstrap uses the same 8s-bounded verification machinery as the
 * offline lifecycle: when the browser explicitly reports offline, the hanging
 * wait is skipped and the offline empty state renders instead of an indefinite
 * spinner.
 *
 * Anonymous visitors may enter `/groups/:id` only when the URL carries a
 * retained `viewKey` or `invite` search param. Everyone else is sent through
 * sign-in so members without a public/invite link are not stranded on a
 * dead-end unauthorized page.
 */
export function RequireAuth({ children }: PropsWithChildren) {
  const { account, isPending, refetch, needsOnboarding, statusPending } =
    useOnboardingStatus()
  const insideProfileGate = useContext(ProfileGateContext)
  const showOfflineEmpty = useOfflineWithoutData(!!account)
  const showServerEmpty = useServerUnreachableWithoutData(!!account)
  const permitsGroupViewer =
    typeof window !== 'undefined' &&
    /^\/groups\/(?!create(?:\/|$)|import(?:\/|$)|bulk-categorize(?:\/|$))[^/]+(?:\/|$)/.test(
      window.location.pathname,
    ) &&
    hasGroupViewerCredential()

  if (isPending && !account) {
    if (showOfflineEmpty) {
      return <OfflineEmptyState variant="page" onRetry={() => void refetch()} />
    }
    if (showServerEmpty) {
      return (
        <ApiErrorEmptyState variant="page" onRetry={() => void refetch()} />
      )
    }
    return (
      <div className="flex flex-1 items-center justify-center py-10">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!account) {
    if (permitsGroupViewer) return <>{children}</>
    if (showOfflineEmpty) {
      return <OfflineEmptyState variant="page" onRetry={() => void refetch()} />
    }
    if (showServerEmpty) {
      return (
        <ApiErrorEmptyState variant="page" onRetry={() => void refetch()} />
      )
    }
    return <Navigate to="/" search={currentBounceSearch()} replace />
  }

  // Fail closed while the authoritative safeguard flag resolves: a named
  // session alone cannot prove completion, so hold the loader instead of
  // flashing protected content or redirecting on the fallback.
  if (statusPending && account.isAnonymous === true) {
    return (
      <div className="flex flex-1 items-center justify-center py-10">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  // The session user cannot see the server's safeguard flag: route through
  // the authoritative onboarding status so named-but-unsafeguarded guests
  // finish setup instead of landing on 412s. Inside ProfileGate the outer
  // gate owns this redirect, so defer to it and avoid a double bounce.
  if (needsOnboarding) {
    if (insideProfileGate) return <>{children}</>
    return (
      <Navigate
        to="/auth/complete-profile"
        search={currentBounceSearch()}
        replace
      />
    )
  }

  return <>{children}</>
}

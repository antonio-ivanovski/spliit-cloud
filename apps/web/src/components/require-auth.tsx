import { Navigate } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import { useContext, type PropsWithChildren } from 'react'

import { ApiErrorEmptyState } from '@/components/api-error-empty-state'
import { OfflineEmptyState } from '@/components/offline-empty-state'
import { useOnboardingStatus } from '@/lib/use-onboarding-status'
import {
  useOfflineWithoutData,
  useServerUnreachableWithoutData,
} from '@/lib/use-online-status'

import { ProfileGateContext } from './profile-gate'

function currentPathWithoutNestedRedirect(): string {
  if (typeof window === 'undefined') return '/'
  let search = window.location.search
  try {
    const params = new URLSearchParams(
      search.startsWith('?') ? search.slice(1) : search,
    )
    // A re-gated bounce already carries `redirect`: strip it so the new
    // target cannot nest (`?redirect=/auth/complete-profile?redirect=…`).
    params.delete('redirect')
    const rest = params.toString()
    search = rest ? `?${rest}` : ''
  } catch {
    // Keep the raw search on parse failure.
  }
  return `${window.location.pathname}${search}${window.location.hash}`
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
    return (
      <Navigate
        to="/"
        search={{ redirect: currentPathWithoutNestedRedirect() }}
        replace
      />
    )
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
    const target = currentPathWithoutNestedRedirect()
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

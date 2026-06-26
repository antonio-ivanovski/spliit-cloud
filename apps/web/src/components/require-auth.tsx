'use client'

import Link from '@/components/link'
import { Button } from '@/components/ui/button'
import { useCurrentAccount } from '@/lib/use-current-account'
import { Navigate } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import { PropsWithChildren } from 'react'
import { useTranslation } from 'react-i18next'

function currentPathWithSearch(): string {
  if (typeof window === 'undefined') return '/'
  return `${window.location.pathname}${window.location.search}`
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

  // Authenticated but missing a display name (e.g. right after a magic-link
  // sign-up). Send them to the profile-completion flow, preserving the
  // original destination so they land back here once they've set a name.
  if (!account.name || account.name === account.email) {
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

/**
 * Fallback UI shown when an authenticated user lands on a group they are not a
 * member of. The API's `loadGroupContext` throws `FORBIDDEN` for non-members,
 * which the tRPC client surfaces as an error; we render this instead of the
 * group layout in that case.
 */
export function UnauthorizedGroup() {
  const { t } = useTranslation(undefined, { keyPrefix: 'Groups' })
  return (
    <div className="flex flex-col gap-3 py-10 text-center">
      <h2 className="text-xl font-semibold">{t('Unauthorized.title')}</h2>
      <p className="text-sm text-muted-foreground max-w-md mx-auto">
        {t('Unauthorized.description')}
      </p>
      <div className="flex justify-center">
        <Button asChild variant="secondary">
          <Link href="/">{t('Unauthorized.link')}</Link>
        </Button>
      </div>
    </div>
  )
}

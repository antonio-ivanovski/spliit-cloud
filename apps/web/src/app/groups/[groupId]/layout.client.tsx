'use client'

import Link from '@/components/link'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import { useCurrentAccount } from '@/lib/use-current-account'
import { trpc } from '@/trpc/client'
import { Navigate, Outlet, useSearch } from '@tanstack/react-router'
import { Cloud, Loader2 } from 'lucide-react'
import { PropsWithChildren, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { CurrentGroupProvider } from './current-group-context'
import { GroupHeader } from './group-header'
import { SaveGroupLocally } from './save-recent-group'

export function GroupLayoutClient({
  groupId,
  children,
}: PropsWithChildren<{ groupId: string }>) {
  // The link-invite token lives in the URL search params, e.g.
  // `/groups/<id>?invite=<token>`. The route search schema captures
  // any non-empty value so the server can decide whether the token is
  // valid. The token is forwarded to `groups.get` as the credential.
  const { invite: linkInviteToken } = useSearch({
    from: '/groups/$groupId',
  })
  const hasInviteInUrl = linkInviteToken !== undefined
  const { data, isLoading, error } = trpc.groups.get.useQuery(
    { groupId, linkInviteToken },
    { retry: false },
  )
  const { t: tNotFound } = useTranslation(undefined, {
    keyPrefix: 'Groups.NotFound',
  })
  const { t: tInvalid } = useTranslation(undefined, {
    keyPrefix: 'Groups.linkInvitationInvalid',
  })
  const { t: tForbidden } = useTranslation(undefined, {
    keyPrefix: 'Groups',
  })
  const { toast } = useToast()
  const { isPending: accountPending } = useCurrentAccount()

  useEffect(() => {
    if (data && !data.group) {
      toast({
        description: tNotFound('text'),
        variant: 'destructive',
      })
    }
  }, [data])

  // Unauthenticated visitors carrying a link-invite token are bounced
  // through the home auth panel with a redirect back here, so the
  // same link is recoverable after sign-in.
  if (
    !accountPending &&
    error?.data?.code === 'UNAUTHORIZED' &&
    hasInviteInUrl
  ) {
    const back = `/groups/${groupId}?invite=${encodeURIComponent(linkInviteToken)}`
    return <Navigate to="/" search={{ redirect: back }} replace />
  }

  // A signed-in visitor with a link token that the server doesn't
  // recognize gets a friendly "invalid link" page instead of a blank
  // FORBIDDEN. Without a token we still surface the original "not a
  // member" message.
  if (!isLoading && error?.data?.code === 'FORBIDDEN' && hasInviteInUrl) {
    return (
      <main className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="flex flex-col items-center gap-3 text-center max-w-md">
          <h1 className="text-2xl font-semibold">{tInvalid('title')}</h1>
          <p className="text-sm text-muted-foreground">
            {tInvalid('description')}
          </p>
          <Button asChild variant="outline">
            <Link href="/">{tForbidden('backToHome')}</Link>
          </Button>
        </div>
      </main>
    )
  }

  if (!isLoading && error?.data?.code === 'FORBIDDEN') {
    return (
      <main className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="flex flex-col items-center gap-3 text-center max-w-md">
          <h1 className="text-2xl font-semibold">
            {tForbidden('Unauthorized.title')}
          </h1>
          <p className="text-sm text-muted-foreground">
            {tForbidden('Unauthorized.description')}
          </p>
          <Button asChild variant="outline">
            <Link href="/">{tForbidden('backToHome')}</Link>
          </Button>
        </div>
      </main>
    )
  }

  // Not-found hand-off: when the local group does not exist, the
  // server returns NOT_FOUND. The web asks the lookup procedure to
  // check the in-memory source cache and, on a miss, attempt a
  // `spliit.app` fetch. A hit returns `IMPORTABLE` and we render a
  // CTA that walks the user into the import wizard with the source
  // pre-filled.
  if (!isLoading && error?.data?.code === 'NOT_FOUND') {
    return <NotFoundGroup groupId={groupId} />
  }

  const props =
    isLoading || !data?.group
      ? {
          isLoading: true as const,
          groupId,
          group: undefined,
          currentLedgerParticipantId: undefined,
          currentMember: undefined,
          currentInvitation: undefined,
          linkInviteState: undefined,
        }
      : {
          isLoading: false as const,
          groupId,
          group: data.group,
          currentLedgerParticipantId: data.currentLedgerParticipantId ?? null,
          currentMember: data.currentMember,
          currentInvitation: data.currentInvitation ?? null,
          linkInviteState: data.linkInviteState ?? null,
        }

  return (
    <CurrentGroupProvider {...props}>
      <div className="flex flex-col gap-3">
        <GroupHeader />
        {children ?? <Outlet />}
      </div>
      <SaveGroupLocally />
    </CurrentGroupProvider>
  )
}

function NotFoundGroup({ groupId }: { groupId: string }) {
  const { t: tNotFound } = useTranslation(undefined, {
    keyPrefix: 'Groups.NotFound',
  })
  const { t: tImportable } = useTranslation(undefined, {
    keyPrefix: 'Groups.Importable',
  })
  const lookup = trpc.groups.lookup.useQuery({ groupId }, { retry: false })
  if (lookup.isLoading) {
    return (
      <main className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" />
          <p className="text-sm">Looking for this group…</p>
        </div>
      </main>
    )
  }
  if (lookup.data?.status === 'IMPORTABLE') {
    const sourceUrl = lookup.data.sourceUrl
    return (
      <main className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="flex flex-col items-center gap-3 text-center max-w-md">
          <Cloud className="w-8 h-8 text-primary" />
          <h1 className="text-2xl font-semibold">{tImportable('title')}</h1>
          <p className="text-sm text-muted-foreground">
            {tImportable('description', { name: lookup.data.source.name })}
          </p>
          <div className="flex gap-2">
            <Button asChild>
              <Link
                href={`/groups/import?source=${encodeURIComponent(sourceUrl)}`}
              >
                {tImportable('cta')}
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/">{tImportable('backToHome')}</Link>
            </Button>
          </div>
        </div>
      </main>
    )
  }
  return (
    <main className="flex-1 flex items-center justify-center px-4 py-10">
      <div className="flex flex-col items-center gap-3 text-center max-w-md">
        <h1 className="text-2xl font-semibold">{tNotFound('text')}</h1>
        <Button asChild variant="outline">
          <Link href="/">{tNotFound('link')}</Link>
        </Button>
      </div>
    </main>
  )
}

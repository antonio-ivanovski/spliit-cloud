import {
  Link,
  Navigate,
  Outlet,
  useLocation,
  useNavigate,
  useSearch,
} from '@tanstack/react-router'
import { Cloud, Loader2, Share2 } from 'lucide-react'
import type { PropsWithChildren } from 'react'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { PageInset } from '@/components/layout/page-shell'
import { GroupMobileAppBar, MobileGroupNav } from '@/components/mobile-shell'
import { OfflineEmptyState } from '@/components/offline-empty-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
import { useToast } from '@/components/ui/use-toast'
import { useEffectiveRuntimeFeatureFlags } from '@/lib/effective-runtime-feature-flags'
import { isFocusedMobilePath, isMobileGroupNavPath } from '@/lib/mobile-nav'
import { useCurrentAccount } from '@/lib/use-current-account'
import { useOnlineStatus } from '@/lib/use-online-status'
import { trpc } from '@/trpc/client'

import { CurrentGroupProvider } from './current-group-context'
import { GroupHeader } from './group-header'
import { SaveGroupLocally } from './save-recent-group'

export function GroupLayoutClient({
  groupId,
  children,
}: PropsWithChildren<{ groupId: string }>) {
  const {
    invite: linkInviteToken,
    viewKey,
    friendLinkInvite: friendLinkInviteUrl,
  } = useSearch({
    from: '/groups/$groupId',
  })
  const [friendLinkDialogUrl, setFriendLinkDialogUrl] = useState<string | null>(
    null,
  )
  const canShare = useSyncExternalStore(
    () => () => {},
    () =>
      typeof navigator !== 'undefined' && typeof navigator.share === 'function',
    () => false,
  )
  const navigate = useNavigate({ from: '/groups/$groupId' })
  const pathname = useLocation({ select: (location) => location.pathname })
  const focusedMobileRoute = isFocusedMobilePath(pathname)
  const showMobileNav = isMobileGroupNavPath(pathname)
  const isPrintReportRoute = pathname.endsWith('/expenses/print')
  // Friend-ledger link-path creation navigates here with the invite URL
  // in the `friendLinkInvite` search param. Open a one-time dialog so the
  // user can copy or share the link before continuing. Strip the param
  // from the URL immediately so a page refresh won't reopen the dialog.
  useEffect(() => {
    if (friendLinkInviteUrl) {
      // oxlint-disable-next-line react/react-compiler -- open the one-time dialog from a URL event.
      setFriendLinkDialogUrl(friendLinkInviteUrl)
      void navigate({
        to: '/groups/$groupId',
        params: { groupId },
        search: (prev) => ({ ...prev, friendLinkInvite: undefined }),
        replace: true,
      })
    }
  }, [friendLinkInviteUrl, groupId, navigate])

  const { data, isLoading, error, refetch } = trpc.groups.get.useQuery(
    { groupId, linkInviteToken, viewKey },
    { retry: false },
  )
  const isOnline = useOnlineStatus()
  const showOfflineEmpty = !isOnline && !data?.group
  const { t: tNotFound } = useTranslation(undefined, {
    keyPrefix: 'Groups.NotFound',
  })
  const { t: tInvalidInvite } = useTranslation(undefined, {
    keyPrefix: 'Groups.linkInvitationInvalid',
  })
  const { t: tInvalidView } = useTranslation(undefined, {
    keyPrefix: 'Groups.viewLinkInvalid',
  })
  const { t: tForbidden } = useTranslation(undefined, {
    keyPrefix: 'Groups',
  })
  const { t: tFriends } = useTranslation(undefined, {
    keyPrefix: 'Friends',
  })
  const { t: tTitles } = useTranslation()
  const { toast } = useToast()
  const { isPending: accountPending } = useCurrentAccount()
  const { flags: effectiveRuntimeFlags } = useEffectiveRuntimeFeatureFlags()

  useEffect(() => {
    if (!data?.group || focusedMobileRoute) return
    const titleKey = pathname.endsWith('/balances')
      ? 'Balances.title'
      : pathname.endsWith('/stats')
        ? 'Stats.title'
        : pathname.endsWith('/activity')
          ? 'Activity.title'
          : pathname.includes('/budgets')
            ? 'Budgets.title'
            : pathname.endsWith('/members')
              ? 'Members.title'
              : 'Expenses.title'
    const groupName = data.displayName ?? data.group.name
    document.title = `${groupName} · ${tTitles(titleKey)}`
  }, [data, focusedMobileRoute, pathname, tTitles])

  useEffect(() => {
    if (data && !data.group) {
      toast({
        description: tNotFound('text'),
        variant: 'destructive',
      })
    }
  }, [data, tNotFound, toast])

  if (showOfflineEmpty) {
    return (
      <main className="flex flex-1 flex-col">
        <OfflineEmptyState variant="page" onRetry={() => void refetch()} />
      </main>
    )
  }

  if (!accountPending && isOnline && error?.data?.code === 'UNAUTHORIZED') {
    return (
      <Navigate
        to="/"
        search={{ redirect: `${pathname}${window.location.search}` }}
        replace
      />
    )
  }

  // Visitors carrying a bearer token that the server doesn't recognize
  // get a token-specific "invalid link" page. Without a token we still
  // surface the original "not a member" message.
  if (!isLoading && error?.data?.code === 'FORBIDDEN' && linkInviteToken) {
    return (
      <main className="flex flex-1 items-center justify-center py-10">
        <PageInset>
          <div className="flex max-w-md flex-col items-center gap-3 text-center">
            <h1 className="text-2xl font-semibold">
              {tInvalidInvite('title')}
            </h1>
            <p className="text-sm text-muted-foreground">
              {tInvalidInvite('description')}
            </p>
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link to="/" />}
            >
              {tForbidden('backToHome')}
            </Button>
          </div>
        </PageInset>
      </main>
    )
  }

  if (!isLoading && error?.data?.code === 'FORBIDDEN' && viewKey) {
    return (
      <main className="flex flex-1 items-center justify-center py-10">
        <PageInset>
          <div className="flex max-w-md flex-col items-center gap-3 text-center">
            <h1 className="text-2xl font-semibold">{tInvalidView('title')}</h1>
            <p className="text-sm text-muted-foreground">
              {tInvalidView('description')}
            </p>
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link to="/" />}
            >
              {tForbidden('backToHome')}
            </Button>
          </div>
        </PageInset>
      </main>
    )
  }

  if (!isLoading && error?.data?.code === 'FORBIDDEN') {
    return (
      <main className="flex flex-1 items-center justify-center py-10">
        <PageInset>
          <div className="flex max-w-md flex-col items-center gap-3 text-center">
            <h1 className="text-2xl font-semibold">
              {tForbidden('Unauthorized.title')}
            </h1>
            <p className="text-sm text-muted-foreground">
              {tForbidden('Unauthorized.description')}
            </p>
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link to="/" />}
            >
              {tForbidden('backToHome')}
            </Button>
          </div>
        </PageInset>
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
          displayName: undefined,
          currentLedgerParticipantId: undefined,
          currentMember: undefined,
          currentInvitation: undefined,
          linkInviteState: undefined,
          viewer: undefined,
        }
      : {
          isLoading: false as const,
          groupId,
          group: data.group,
          displayName: data.displayName ?? '',
          currentLedgerParticipantId: data.currentLedgerParticipantId ?? null,
          currentMember: data.currentMember,
          currentInvitation: data.currentInvitation ?? null,
          linkInviteState: data.linkInviteState ?? null,
          viewer: data.viewer,
          hasSavedView: data.hasSavedView,
        }

  return (
    <CurrentGroupProvider {...props}>
      <GroupMobileAppBar />
      {/* Keep this wrapper transform-free: expense forms contain a
          viewport-fixed action bar. */}
      <div
        className={`flex min-w-0 flex-col gap-0 sm:gap-3 ${showMobileNav ? 'pb-(--mobile-nav-height) sm:pb-0' : ''}`}
      >
        {!isPrintReportRoute && (
          <PageInset>
            <GroupHeader
              enableReceiptExtract={effectiveRuntimeFlags.enableReceiptExtract}
              enableVoiceExpense={effectiveRuntimeFlags.enableVoiceExpense}
            />
          </PageInset>
        )}
        {children ?? <Outlet />}
      </div>
      {!isPrintReportRoute && showMobileNav && (
        <MobileGroupNav groupId={props.groupId} />
      )}
      {!isPrintReportRoute && <SaveGroupLocally />}
      <ResponsiveDialog
        open={!!friendLinkDialogUrl}
        onOpenChange={(open) => {
          if (!open) setFriendLinkDialogUrl(null)
        }}
      >
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>
              {tFriends('inviteLinkTitle')}
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              {tFriends('inviteLinkDescription')}
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <ResponsiveDialogBody>
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={friendLinkDialogUrl ?? ''}
                className="font-mono text-xs"
                onFocus={(event) => event.currentTarget.select()}
              />
              {friendLinkDialogUrl && (
                <CopyButton
                  text={friendLinkDialogUrl}
                  ariaLabel={tFriends('copyInviteLink')}
                  copiedLabel={tFriends('copiedInviteLink')}
                />
              )}
              {canShare && friendLinkDialogUrl && (
                <Button
                  size="icon"
                  variant="secondary"
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.share({
                        title: tFriends('inviteLinkTitle'),
                        text: `${tFriends('inviteLinkDescription')} ${friendLinkDialogUrl}`,
                      })
                    } catch (err) {
                      if (err instanceof Error && err.name !== 'AbortError') {
                        console.warn('[group-layout] share failed:', err)
                      }
                    }
                  }}
                  aria-label={tFriends('share')}
                >
                  <Share2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          </ResponsiveDialogBody>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
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
      <main className="flex flex-1 items-center justify-center py-10">
        <PageInset>
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <p className="text-sm">{tNotFound('lookingUp')}</p>
          </div>
        </PageInset>
      </main>
    )
  }
  if (lookup.data?.status === 'IMPORTABLE') {
    const sourceUrl = lookup.data.sourceUrl
    return (
      <main className="flex flex-1 items-center justify-center py-10">
        <PageInset>
          <div className="flex max-w-md flex-col items-center gap-3 text-center">
            <Cloud className="h-8 w-8 text-primary" />
            <h1 className="text-2xl font-semibold">{tImportable('title')}</h1>
            <p className="text-sm text-muted-foreground">
              {tImportable('description', { name: lookup.data.source.name })}
            </p>
            <div className="flex gap-2">
              <Button
                nativeButton={false}
                render={
                  <Link to="/groups/import" search={{ prefill: sourceUrl }} />
                }
              >
                {tImportable('cta')}
              </Button>
              <Button
                variant="outline"
                nativeButton={false}
                render={<Link to="/" />}
              >
                {tImportable('backToHome')}
              </Button>
            </div>
          </div>
        </PageInset>
      </main>
    )
  }
  return (
    <main className="flex flex-1 items-center justify-center py-10">
      <PageInset>
        <div className="flex max-w-md flex-col items-center gap-3 text-center">
          <h1 className="text-2xl font-semibold">{tNotFound('text')}</h1>
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link to="/" />}
          >
            {tNotFound('link')}
          </Button>
        </div>
      </PageInset>
    </main>
  )
}

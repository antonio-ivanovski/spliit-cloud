import { GroupTabs } from '@/app/groups/[groupId]/group-tabs'
import Link from '@/components/link'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/use-toast'
import { useRouter } from '@/lib/navigation'
import { trpc } from '@/trpc/client'
import { useSearch } from '@tanstack/react-router'
import { ArrowLeft, Check, Info, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useCurrentGroup } from './current-group-context'

export const GroupHeader = () => {
  const {
    isLoading,
    groupId,
    group,
    currentMember,
    currentInvitation,
    linkInviteState,
  } = useCurrentGroup()
  const { t: tGroups } = useTranslation(undefined, { keyPrefix: 'Groups' })
  const { toast } = useToast()
  const router = useRouter()
  const utils = trpc.useUtils()

  // The `?invite=<token>` search param is the single source of truth
  // for link-invite banner state. The route schema captures any
  // non-empty string and leaves token validity to the server.
  const { invite: inviteToken } = useSearch({
    from: '/groups/$groupId',
  })

  const acceptLinkMutation = trpc.invitations.acceptLink.useMutation({
    onSuccess: async () => {
      toast({ description: tGroups('invitationAccepted') })
      await Promise.all([
        utils.groups.get.invalidate({ groupId }),
        utils.account.groups.invalidate(),
        utils.invitations.listForAccount.invalidate(),
        utils.invitations.list.invalidate({ groupId }),
      ])
      // Strip the consumed `?invite=<token>` so the URL returns to the
      // plain group page — otherwise the "already a member" banner
      // would reappear on the next load.
      router.push({
        to: '/groups/$groupId',
        params: { groupId },
        search: { invite: undefined },
      })
    },
    onError: (err) => {
      toast({
        description: err.message,
        variant: 'destructive',
      })
    },
  })

  const acceptMutation = trpc.invitations.accept.useMutation({
    onSuccess: async () => {
      toast({ description: tGroups('invitationAccepted') })
      await Promise.all([
        utils.groups.get.invalidate({ groupId }),
        utils.account.groups.invalidate(),
        utils.invitations.listForAccount.invalidate(),
      ])
      router.refresh()
    },
    onError: (err) => {
      toast({
        description: err.message,
        variant: 'destructive',
      })
    },
  })

  const declineMutation = trpc.invitations.decline.useMutation({
    onSuccess: async () => {
      toast({ description: tGroups('invitationDeclined') })
      await Promise.all([
        utils.groups.get.invalidate({ groupId }),
        utils.invitations.listForAccount.invalidate(),
      ])
      router.refresh()
    },
    onError: (err) => {
      toast({
        description: err.message,
        variant: 'destructive',
      })
    },
  })

  // For link invites the preview is fetched separately to surface
  // the inviter name and the temporary name in the banner. The
  // preview is only useful while the URL still carries a token and
  // the viewer hasn't accepted yet.
  const previewQuery = trpc.invitations.previewLink.useQuery(
    { token: inviteToken ?? '' },
    { enabled: !!inviteToken, retry: false },
  )

  // Banner state comes from the server-side `linkInviteState` (set
  // by `groups.get` when a token is in the URL). `null` means the
  // URL has no token — we fall back to the regular email-invite
  // banner.
  const showLinkAlreadyMember = !!inviteToken && !!currentMember && !isLoading

  const showLinkExpiredOrInvalid =
    !!inviteToken &&
    !currentMember &&
    !currentInvitation &&
    !isLoading &&
    (linkInviteState === 'EXPIRED' ||
      linkInviteState === 'REVOKED' ||
      linkInviteState === 'DECLINED' ||
      linkInviteState === 'ACCEPTED')

  // Strip the `?invite=<token>` from the URL. Used by the "already a
  // member" banner, where the viewer can stay on the group page.
  const stripInviteFromUrl = () =>
    router.push({
      to: '/groups/$groupId',
      params: { groupId },
      search: { invite: undefined },
    })

  // Leave the group page entirely. Used by the "no longer valid"
  // banner, where the viewer is not a member and the bare group URL
  // would surface the "you don't have access" page.
  const leaveToGroupsList = () => router.push({ to: '/' })

  const isLinkBanner = currentInvitation?.type === 'LINK'

  return (
    <div className="flex flex-col justify-between gap-3">
      <h1 className="font-bold text-2xl flex items-center gap-2">
        <Button variant="ghost" size="icon" asChild className="-ml-2">
          <Link href="/" title={tGroups('backToHome')}>
            <ArrowLeft className="w-5 h-5" />
          </Link>
        </Button>
        <Link href={`/groups/${groupId}`}>
          {isLoading ? (
            <Skeleton className="mt-1.5 mb-1.5 h-5 w-32" />
          ) : (
            <div className="flex">{group.name}</div>
          )}
        </Link>
      </h1>

      {currentInvitation && (
        <Alert data-testid="invitation-banner">
          <AlertTitle>{tGroups('invitationBannerTitle')}</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-3">
            <div className="flex flex-col gap-1">
              <span>
                {isLinkBanner
                  ? tGroups('linkInvitationBannerDescription', {
                      inviter: previewQuery.data?.preview?.inviter.name ?? '',
                      groupName: group.name,
                    })
                  : tGroups('invitationBannerDescription')}
              </span>
              {isLinkBanner && (
                <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>{tGroups('linkInvitationSingleUse')}</span>
                </p>
              )}
              {currentInvitation.type === 'EMAIL' &&
                previewQuery.data?.preview?.temporaryName && (
                  <p className="text-xs text-muted-foreground">
                    {tGroups('linkInvitationTemporaryName', {
                      name: previewQuery.data.preview.temporaryName,
                    })}
                  </p>
                )}
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() =>
                  isLinkBanner && inviteToken
                    ? acceptLinkMutation.mutate({ token: inviteToken })
                    : acceptMutation.mutate({
                        invitationId: currentInvitation.id,
                      })
                }
                disabled={
                  acceptMutation.isPending ||
                  declineMutation.isPending ||
                  acceptLinkMutation.isPending
                }
              >
                <Check className="w-4 h-4 mr-2" />
                {tGroups('invitationAccept')}
              </Button>
              {isLinkBanner ? (
                // Link invites are one-shot: declining just drops the
                // token from the URL. The viewer is a non-member so
                // the bare group URL would surface the "no access"
                // page — send them to the groups list instead.
                <Button
                  size="sm"
                  variant="outline"
                  onClick={leaveToGroupsList}
                  disabled={acceptLinkMutation.isPending}
                >
                  <X className="w-4 h-4 mr-2" />
                  {tGroups('invitationDecline')}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    declineMutation.mutate({
                      invitationId: currentInvitation.id,
                    })
                  }
                  disabled={
                    acceptMutation.isPending || declineMutation.isPending
                  }
                >
                  <X className="w-4 h-4 mr-2" />
                  {tGroups('invitationDecline')}
                </Button>
              )}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {showLinkAlreadyMember && (
        <Alert data-testid="invitation-already-member-banner">
          <AlertTitle>
            {tGroups('linkInvitationAlreadyMemberTitle', {
              groupName: group.name,
            })}
          </AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-3">
            <span>
              {tGroups('linkInvitationAlreadyMemberDescription', {
                groupName: group.name,
              })}
            </span>
            <Button size="sm" variant="outline" onClick={stripInviteFromUrl}>
              {tGroups('linkInvitationDismiss')}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {showLinkExpiredOrInvalid && (
        <Alert data-testid="invitation-expired-banner">
          <AlertTitle>{tGroups('linkInvitationExpiredTitle')}</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-3">
            <span>{tGroups('linkInvitationExpiredDescription')}</span>
            <Button size="sm" variant="outline" onClick={leaveToGroupsList}>
              {tGroups('linkInvitationDismiss')}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Group tabs are rendered for active members (including those
          carrying a link token) so they can navigate the group.
          Tabs are suppressed when a pending invite banner is showing
          — the viewer is read-only and the affordances would be
          misleading. They're also suppressed for the "no longer
          valid" link banner since the viewer can't act. */}
      {currentMember && !isLoading && (
        <div className="flex flex-col gap-3">
          <GroupTabs groupId={groupId} />
        </div>
      )}
    </div>
  )
}

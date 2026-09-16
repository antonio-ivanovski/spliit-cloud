import { Ban, Link2, Mail, Pencil, QrCode, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AccountAvatar } from '@/components/account-avatar'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/use-toast'
import { trpc } from '@/trpc/client'

import {
  badgeVariantForRole,
  formatDate,
  roleLabel,
  type PendingInvitation,
} from './members-hooks'
import { ResponsiveParticipantActions } from './responsive-participant-actions'
import { SegmentedActions } from './segmented-actions'

/**
 * Compact one-line joiner names for a QR row: first names + language-neutral
 * remainder.
 */
function qrJoinerNames(invitation: PendingInvitation): string | null {
  const names = invitation.recentJoiners
    .map((joiner) => joiner.name)
    .filter((name): name is string => !!name && name.trim().length > 0)
  if (names.length === 0) return null
  const shown = names.slice(0, 3).join(', ')
  return names.length > 3 ? `${shown} +${names.length - 3}` : shown
}

export function PendingInvitationsCard({
  invitations,
  isLoading,
  onManage,
  onManageButtonRef,
  onGenerateLink,
  onGenerateButtonRef,
  onRevoke,
  onViewQr,
  activeQrSessionId,
  onQrSessionInvalidated,
  locale,
  timeZone,
}: {
  invitations: PendingInvitation[]
  isLoading: boolean
  onManage: (invitation: PendingInvitation) => void
  onManageButtonRef: (
    invitationId: string,
    element: HTMLButtonElement | null,
  ) => void
  onGenerateLink: (invitation: PendingInvitation) => void
  onGenerateButtonRef: (
    invitationId: string,
    element: HTMLButtonElement | null,
  ) => void
  onRevoke: (invitation: { ledgerParticipantId: string; label: string }) => void
  /** Switch the invite card to the QR tab (shows the live code / session). */
  onViewQr: () => void
  /** Id of the QR session displayed in the QR tab, if this browser holds one. */
  activeQrSessionId: string | null
  /** Clear the displayed QR code (its session was expired from this list). */
  onQrSessionInvalidated: () => void
  locale: string
  timeZone: string
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Members' })
  const { toast } = useToast()
  const utils = trpc.useUtils()

  // Expired QR sessions are dead codes, not actionable invitations. The
  // expiry comparison reads the clock, so tick on the same cadence as the QR
  // tab's countdown: without this, an expired session stays actionable here
  // while the QR tab is unmounted (the shared list query does not poll).
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 5000)
    return () => window.clearInterval(timer)
  }, [])
  const visibleInvitations = invitations.filter((invitation) => {
    const isQrSession = invitation.type === 'LINK' && invitation.isMultiUse
    if (!isQrSession) return true
    return (
      !invitation.expiresAt || new Date(invitation.expiresAt).getTime() >= nowMs
    )
  })

  // QR sessions carry no ledger participant, so the participant-based revoke
  // flow cannot handle them — revoke directly by invitation id. Expiring the
  // session this browser displays must also clear the tab's code (no zombie).
  const expireQrMutation = trpc.invitations.revoke.useMutation({
    onSuccess: async (_data, vars) => {
      toast({ description: t('invitations.revoked') })
      if (vars.invitationId === activeQrSessionId) {
        onQrSessionInvalidated()
      }
      const groupId = invitations.find(
        (i) => i.id === vars.invitationId,
      )?.groupId
      if (groupId) {
        await utils.invitations.list.invalidate({ groupId })
      } else {
        await utils.invitations.list.invalidate()
      }
    },
    onError: (error, vars) => {
      toast({ description: error.message, variant: 'destructive' })
      // The session may already be dead server-side: refresh so the row
      // converges instead of lingering as a zombie.
      const groupId = invitations.find(
        (i) => i.id === vars.invitationId,
      )?.groupId
      if (groupId) {
        void utils.invitations.list.invalidate({ groupId })
      } else {
        void utils.invitations.list.invalidate()
      }
    },
  })

  const roleLabels = {
    ADMIN: t('role.admin'),
    MEMBER: t('role.member'),
  } as const

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('invitations.title')}</CardTitle>
        <CardDescription>{t('invitations.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex flex-col divide-y">
            {[0, 1].map((index) => (
              <div
                // react-doctor-disable-next-line react-doctor/no-array-index-as-key -- static skeleton rows, no per-item identity
                key={index}
                className="flex min-h-[52px] items-center gap-3 py-3 first:pt-0 last:pb-0"
              >
                <Skeleton className="size-8 shrink-0 rounded-full" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
                <Skeleton className="h-9 w-24 shrink-0 rounded-md" />
              </div>
            ))}
          </div>
        ) : visibleInvitations.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">
            {t('invitations.empty')}
          </p>
        ) : (
          <ul className="flex flex-col divide-y">
            {visibleInvitations.map((invitation) => {
              const isLink = invitation.type === 'LINK'
              const isQrSession = isLink && invitation.isMultiUse
              // The expiry comparison must happen at render time; the
              // server emits expiresAt and the badge follows the clock.
              const isExpired =
                isLink &&
                !!invitation.expiresAt &&
                // oxlint-disable-next-line react/react-compiler -- per-row clock read
                new Date(invitation.expiresAt).getTime() < Date.now()
              const profile = invitation.recipientProfile
              const effectiveName =
                profile?.name ??
                invitation.temporaryName ??
                (isQrSession
                  ? t('invitations.qr.fallbackLabel')
                  : isLink
                    ? t('invitations.link.fallbackLabel')
                    : invitation.email)
              const subtitle = isQrSession
                ? [
                    t('invite.qr.joined', { count: invitation.useCount }),
                    qrJoinerNames(invitation),
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : isLink
                  ? t('invitations.link.anyoneWithLink')
                  : invitation.email
              // Without a temporary name the label IS the email; showing it
              // twice on the same row is noise.
              const nameIsEmail = effectiveName === invitation.email
              const DeliveryIcon = isQrSession ? QrCode : isLink ? Link2 : Mail
              const detail = isLink
                ? [
                    subtitle,
                    invitation.expiresAt
                      ? t('invitations.link.expiresOn', {
                          date: formatDate(
                            invitation.expiresAt,
                            locale,
                            timeZone,
                          ),
                        })
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : !nameIsEmail
                  ? subtitle
                  : null
              return (
                <li
                  key={invitation.id}
                  className="grid min-h-[52px] grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 py-3 first:pt-0 last:pb-0 sm:items-center"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    {isQrSession ? (
                      <Avatar
                        aria-hidden="true"
                        className="mt-0.5 size-8 shrink-0 bg-primary/15 text-sm ring-1 ring-primary/20"
                      >
                        <AvatarFallback className="bg-primary/15 leading-none font-semibold text-[inherit] text-primary">
                          <QrCode className="size-4" aria-hidden="true" />
                        </AvatarFallback>
                      </Avatar>
                    ) : (
                      <AccountAvatar
                        account={
                          profile ?? {
                            id: invitation.id,
                            name: effectiveName,
                            image: null,
                          }
                        }
                        size="lg"
                        className="mt-0.5 shrink-0"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
                        <span className="truncate font-medium text-foreground">
                          {effectiveName}
                        </span>
                        <span className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline" className="shrink-0 gap-1">
                            <DeliveryIcon
                              className="size-3"
                              aria-hidden="true"
                            />
                            {isQrSession
                              ? t('invitations.qr.type')
                              : isLink
                                ? t('invitations.link.type')
                                : t('invitations.email.type')}
                          </Badge>
                          {isExpired && (
                            <Badge
                              variant="outline"
                              className="shrink-0 border-destructive/40 text-destructive"
                            >
                              {t('invitations.link.expired')}
                            </Badge>
                          )}
                          <Badge
                            variant={badgeVariantForRole(invitation.role)}
                            className="shrink-0"
                          >
                            {roleLabel(invitation.role, roleLabels)}
                          </Badge>
                        </span>
                      </div>
                      {detail && (
                        <p
                          className="mt-0.5 truncate text-xs text-muted-foreground"
                          title={detail}
                        >
                          {detail}
                        </p>
                      )}
                    </div>
                  </div>
                  {isQrSession ? (
                    <ResponsiveParticipantActions
                      label={t('actionsFor', { name: effectiveName })}
                      desktopActions={
                        <SegmentedActions>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="rounded-none"
                            aria-label={t('invitations.qr.viewQr')}
                            title={t('invitations.qr.viewQr')}
                            onClick={onViewQr}
                          >
                            <QrCode size={16} aria-hidden="true" />
                          </Button>
                          {invitation.canRevoke && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="rounded-none text-destructive hover:bg-destructive/10 hover:text-destructive"
                              aria-label={t('invitations.qr.expireNow')}
                              title={t('invitations.qr.expireNow')}
                              disabled={expireQrMutation.isPending}
                              onClick={() =>
                                void expireQrMutation.mutateAsync({
                                  invitationId: invitation.id,
                                })
                              }
                            >
                              <Ban size={16} aria-hidden="true" />
                            </Button>
                          )}
                        </SegmentedActions>
                      }
                      mobileActions={[
                        {
                          key: 'view-qr',
                          label: t('invitations.qr.viewQr'),
                          icon: QrCode,
                          onSelect: onViewQr,
                        },
                        ...(invitation.canRevoke
                          ? [
                              {
                                key: 'expire-qr',
                                label: t('invitations.qr.expireNow'),
                                icon: Ban,
                                destructive: true,
                                disabled: expireQrMutation.isPending,
                                onSelect: () =>
                                  expireQrMutation.mutate({
                                    invitationId: invitation.id,
                                  }),
                              },
                            ]
                          : []),
                      ]}
                    />
                  ) : invitation.canManage ||
                    (invitation.canRevoke && invitation.ledgerParticipantId) ? (
                    <ResponsiveParticipantActions
                      label={t('actionsFor', { name: effectiveName })}
                      mobileTriggerRef={(element) => {
                        if (invitation.canManage) {
                          onManageButtonRef(invitation.id, element)
                        }
                        if (invitation.canManage && isLink) {
                          onGenerateButtonRef(invitation.id, element)
                        }
                      }}
                      desktopActions={
                        <SegmentedActions>
                          {invitation.canManage && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="rounded-none"
                              aria-label={t('manage.manageButton')}
                              title={t('manage.manageButton')}
                              ref={(element) =>
                                onManageButtonRef(invitation.id, element)
                              }
                              onClick={() => onManage(invitation)}
                            >
                              <Pencil size={16} aria-hidden="true" />
                            </Button>
                          )}
                          {invitation.canManage && isLink && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="rounded-none"
                              aria-label={t('invite.link.generateNew')}
                              title={t('invite.link.generateNew')}
                              ref={(element) =>
                                onGenerateButtonRef(invitation.id, element)
                              }
                              onClick={() => onGenerateLink(invitation)}
                            >
                              <RefreshCw size={16} aria-hidden="true" />
                            </Button>
                          )}
                          {invitation.canRevoke &&
                            invitation.ledgerParticipantId && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="rounded-none text-destructive hover:bg-destructive/10 hover:text-destructive"
                                aria-label={t('invitations.revokeButton')}
                                title={t('invitations.revokeButton')}
                                onClick={() =>
                                  onRevoke({
                                    ledgerParticipantId:
                                      invitation.ledgerParticipantId!,
                                    label: effectiveName,
                                  })
                                }
                              >
                                <Ban size={16} aria-hidden="true" />
                              </Button>
                            )}
                        </SegmentedActions>
                      }
                      mobileActions={[
                        ...(invitation.canManage
                          ? [
                              {
                                key: 'manage',
                                label: t('manage.manageButton'),
                                icon: Pencil,
                                onSelect: () => onManage(invitation),
                              },
                            ]
                          : []),
                        ...(invitation.canManage && isLink
                          ? [
                              {
                                key: 'regenerate',
                                label: t('invite.link.generateNew'),
                                icon: RefreshCw,
                                onSelect: () => onGenerateLink(invitation),
                              },
                            ]
                          : []),
                        ...(invitation.canRevoke &&
                        invitation.ledgerParticipantId
                          ? [
                              {
                                key: 'revoke',
                                label: t('invitations.revokeButton'),
                                icon: Ban,
                                destructive: true,
                                onSelect: () =>
                                  onRevoke({
                                    ledgerParticipantId:
                                      invitation.ledgerParticipantId!,
                                    label: effectiveName,
                                  }),
                              },
                            ]
                          : []),
                      ]}
                    />
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

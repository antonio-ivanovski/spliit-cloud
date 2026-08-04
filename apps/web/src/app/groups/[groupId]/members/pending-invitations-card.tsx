import { Ban, Link2, Mail, Pencil, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AccountAvatar } from '@/components/account-avatar'
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

import {
  badgeVariantForRole,
  formatDate,
  roleLabel,
  type PendingInvitation,
} from './members-hooks'
import { SegmentedActions } from './segmented-actions'

export function PendingInvitationsCard({
  invitations,
  isLoading,
  onManage,
  onManageButtonRef,
  onGenerateLink,
  onGenerateButtonRef,
  onRevoke,
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
  locale: string
  timeZone: string
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Members' })

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
        ) : invitations.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">
            {t('invitations.empty')}
          </p>
        ) : (
          <ul className="flex flex-col divide-y">
            {invitations.map((invitation) => {
              const isLink = invitation.type === 'LINK'
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
                (isLink
                  ? t('invitations.link.fallbackLabel')
                  : invitation.email)
              const subtitle = isLink
                ? t('invitations.link.anyoneWithLink')
                : invitation.email
              // Without a temporary name the label IS the email; showing it
              // twice on the same row is noise.
              const nameIsEmail = effectiveName === invitation.email
              const DeliveryIcon = isLink ? Link2 : Mail
              return (
                <li
                  key={invitation.id}
                  className="flex min-h-[52px] flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 items-start gap-3">
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
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-medium text-foreground">
                          {effectiveName}
                        </span>
                        <Badge variant="outline" className="shrink-0 gap-1">
                          <DeliveryIcon className="size-3" aria-hidden="true" />
                          {isLink
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
                      </div>
                      {subtitle && !nameIsEmail && (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {subtitle}
                        </p>
                      )}
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {t('invitations.updatedOn', {
                          date: formatDate(
                            invitation.updatedAt,
                            locale,
                            timeZone,
                          ),
                        })}
                        {isLink && invitation.expiresAt
                          ? ` · ${t('invitations.link.expiresOn', {
                              date: formatDate(
                                invitation.expiresAt,
                                locale,
                                timeZone,
                              ),
                            })}`
                          : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex w-full flex-wrap items-center justify-start gap-2 sm:w-auto sm:justify-end">
                    {invitation.canManage ||
                    (invitation.canRevoke && invitation.ledgerParticipantId) ? (
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
                            <Pencil className="size-4" aria-hidden="true" />
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
                            <RefreshCw className="size-4" aria-hidden="true" />
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
                              <Ban className="size-4" aria-hidden="true" />
                            </Button>
                          )}
                      </SegmentedActions>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

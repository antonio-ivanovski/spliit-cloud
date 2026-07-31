import { Ban } from 'lucide-react'
import { useTranslation } from 'react-i18next'

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
import { isPlaceholderEmail } from '@/lib/account'

import { formatDate } from './members-hooks'

type Invitation = {
  id: string
  email: string
  type: string
  role: 'ADMIN' | 'MEMBER'
  temporaryName: string | null
  status: string
  createdAt: Date | string | null
  ledgerParticipantId: string | null
  canRevoke: boolean
}

export function PendingInvitationsCard({
  invitations,
  isLoading,
  onRevoke,
  locale,
  timeZone,
}: {
  invitations: Invitation[]
  isLoading: boolean
  onRevoke: (invitation: { ledgerParticipantId: string; label: string }) => void
  locale: string
  timeZone: string
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Members' })

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('invitations.title')}</CardTitle>
        <CardDescription>{t('invitations.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex flex-col gap-3 py-1">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : invitations.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">
            {t('invitations.empty')}
          </p>
        ) : (
          <ul className="flex flex-col divide-y">
            {invitations.map((invitation) => {
              const isLink = invitation.type === 'LINK'
              const label = isLink
                ? (invitation.temporaryName ??
                  t('invitations.link.fallbackLabel'))
                : (invitation.temporaryName ??
                  (isPlaceholderEmail(invitation.email)
                    ? t('invitations.link.fallbackLabel')
                    : invitation.email))
              const ledgerParticipantId = invitation.ledgerParticipantId
              return (
                <li
                  key={invitation.id}
                  className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium text-foreground">
                        {label}
                      </span>
                      <Badge variant="outline" className="shrink-0">
                        {isLink
                          ? t('invitations.link.type')
                          : t('invitations.email.type')}
                      </Badge>
                    </div>
                    {invitation.createdAt && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {t('invitations.sentOn', {
                          date: formatDate(
                            invitation.createdAt,
                            locale,
                            timeZone,
                          ),
                        })}
                      </p>
                    )}
                  </div>
                  {invitation.status === 'PENDING' &&
                    invitation.canRevoke &&
                    ledgerParticipantId && (
                      <div className="flex w-full flex-wrap items-center justify-start gap-2 sm:w-auto sm:justify-end">
                        <Button
                          variant="destructive"
                          size="sm"
                          className="h-9 shrink-0 gap-1.5 px-3"
                          onClick={() =>
                            onRevoke({ ledgerParticipantId, label })
                          }
                        >
                          <Ban className="size-4" aria-hidden="true" />
                          {t('invitations.revokeButton')}
                        </Button>
                      </div>
                    )}
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

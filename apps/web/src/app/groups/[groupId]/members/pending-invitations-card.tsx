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
import { useTranslation } from 'react-i18next'
import { formatDate, roleLabel } from './members-hooks'

type Invitation = {
  id: string
  email: string
  type: string
  role: 'ADMIN' | 'MEMBER'
  temporaryName: string | null
  status: string
  createdAt: Date | string | null
}

export function PendingInvitationsCard({
  invitations,
  isLoading,
  revokeMutation,
  onRevoke,
  roleLabels,
  locale,
}: {
  invitations: Invitation[]
  isLoading: boolean
  revokeMutation: { isPending: boolean }
  onRevoke: (invitation: { id: string; email: string; label: string }) => void
  roleLabels: { ADMIN: string; MEMBER: string }
  locale: string
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
          <p className="text-sm text-muted-foreground py-2">
            {t('invitations.empty')}
          </p>
        ) : (
          <ul className="flex flex-col divide-y">
            {invitations.map((invitation) => {
              const isLink = invitation.type === 'LINK'
              const label = isLink
                ? (invitation.temporaryName ??
                  t('invitations.link.fallbackLabel'))
                : (invitation.temporaryName ?? invitation.email)
              return (
                <li
                  key={invitation.id}
                  className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-foreground truncate">
                        {label}
                      </span>
                      <Badge variant="secondary" className="shrink-0">
                        {roleLabel(invitation.role, roleLabels)}
                      </Badge>
                      {isLink && (
                        <Badge variant="outline" className="shrink-0">
                          {t('invitations.link.type')}
                        </Badge>
                      )}
                      <Badge variant="outline" className="shrink-0">
                        {invitation.status}
                      </Badge>
                    </div>
                    {invitation.createdAt && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {t('invitations.sentOn', {
                          date: formatDate(invitation.createdAt, locale),
                        })}
                      </p>
                    )}
                  </div>
                  {invitation.status === 'PENDING' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive shrink-0"
                      disabled={revokeMutation.isPending}
                      onClick={() =>
                        onRevoke({
                          id: invitation.id,
                          email: invitation.email,
                          label,
                        })
                      }
                    >
                      {t('invitations.revokeButton')}
                    </Button>
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

import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowRight, Check, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useSyncedAccountPreferences } from '@/components/account-preferences-sync'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { useToast } from '@/components/ui/use-toast'
import { useLocale } from '@/i18n/react'
import { isPlaceholderEmail } from '@/lib/account'
import { detectDeviceTimeZone } from '@/lib/account-preferences'
import { invalidateAccountGroupLists } from '@/lib/invalidate-account-groups'
import { useOfflineWithoutData, useOnlineStatus } from '@/lib/use-online-status'
import { trpc } from '@/trpc/client'

import { formatDate } from './group-buckets'

export function PendingInvitations() {
  const { t } = useTranslation(undefined, { keyPrefix: 'Groups' })
  const locale = useLocale()
  const accountPreferences = useSyncedAccountPreferences()
  const navigate = useNavigate()
  const { toast } = useToast()
  const utils = trpc.useUtils()
  const isOnline = useOnlineStatus()
  const invitationsQuery = trpc.invitations.listForAccount.useQuery(undefined, {
    enabled: isOnline,
  })
  const showOfflineEmpty = useOfflineWithoutData(!!invitationsQuery.data)

  const acceptMutation = trpc.invitations.accept.useMutation({
    onSuccess: (data) => {
      toast({
        description: t('invitations.accepted'),
        variant: 'success',
      })
      void navigate({
        to: '/groups/$groupId',
        params: { groupId: data.groupId },
      })
      void invalidateAccountGroupLists(utils)
      void utils.invitations.listForAccount.invalidate()
    },
    onError: (error) => {
      toast({ description: error.message, variant: 'destructive' })
    },
  })

  const declineMutation = trpc.invitations.decline.useMutation({
    onSuccess: () => {
      toast({ description: t('invitations.declined') })
      void utils.invitations.listForAccount.invalidate()
    },
    onError: (error) => {
      toast({ description: error.message, variant: 'destructive' })
    },
  })

  const invitations = invitationsQuery.data?.invitations ?? []

  if (showOfflineEmpty) return null

  if (invitationsQuery.isLoading) return null

  if (invitations.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {t('invitations.title')}
          <Badge variant="secondary">{invitations.length}</Badge>
        </CardTitle>
        <CardDescription>{t('invitations.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col divide-y rounded-lg border">
          {invitations.map((invitation) => {
            const inviterName =
              invitation.invitedBy?.name ||
              (!isPlaceholderEmail(invitation.invitedBy?.email) &&
                invitation.invitedBy?.email) ||
              t('invitations.unknownInviter')
            const groupId = invitation.group?.id
            return (
              <li
                key={invitation.id}
                className="relative flex flex-col gap-2 p-3 first:rounded-t-lg last:rounded-b-lg sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 flex-1">
                  {groupId ? (
                    <Link
                      to="/groups/$groupId"
                      params={{ groupId }}
                      className="font-medium text-foreground no-underline outline-hidden before:absolute before:inset-0 before:rounded-md before:content-[''] focus-visible:underline"
                      title={
                        invitation.group?.name ?? t('invitations.unknownGroup')
                      }
                    >
                      {invitation.group?.name ?? t('invitations.unknownGroup')}
                    </Link>
                  ) : (
                    <p className="truncate font-medium text-foreground">
                      {invitation.group?.name ?? t('invitations.unknownGroup')}
                    </p>
                  )}
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {t('invitations.invitedBy', { name: inviterName })}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t('invitations.sentOn', {
                      date: formatDate(
                        invitation.createdAt,
                        locale,
                        accountPreferences?.timeZone ??
                          detectDeviceTimeZone() ??
                          'UTC',
                      ),
                    })}
                  </p>
                </div>
                <div className="relative z-10 flex gap-2 sm:shrink-0">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!isOnline || declineMutation.isPending}
                    onClick={() =>
                      declineMutation.mutate({ invitationId: invitation.id })
                    }
                  >
                    <X className="me-1 h-4 w-4" />
                    {t('invitations.decline')}
                  </Button>
                  <Button
                    size="sm"
                    disabled={!isOnline || acceptMutation.isPending}
                    onClick={() =>
                      acceptMutation.mutate({ invitationId: invitation.id })
                    }
                  >
                    <Check className="me-1 h-4 w-4" />
                    {t('invitations.accept')}
                    <ArrowRight className="ms-1 h-4 w-4 rtl:rotate-180" />
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}

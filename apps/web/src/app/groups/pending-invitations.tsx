import Link from '@/components/link'
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
import { useLocale } from '@/i18n/react'
import { useRouter } from '@/lib/navigation'
import { trpc } from '@/trpc/client'
import { ArrowRight, Check, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatDate } from './group-buckets'

export function PendingInvitations() {
  const { t } = useTranslation(undefined, { keyPrefix: 'Groups' })
  const locale = useLocale()
  const router = useRouter()
  const { toast } = useToast()
  const utils = trpc.useUtils()
  const invitationsQuery = trpc.invitations.listForAccount.useQuery()

  const acceptMutation = trpc.invitations.accept.useMutation({
    onSuccess: (data) => {
      toast({ description: t('invitations.accepted') })
      router.push({ to: '/groups/$groupId', params: { groupId: data.groupId } })
      utils.account.groups.invalidate()
      utils.invitations.listForAccount.invalidate()
    },
    onError: (error) => {
      toast({ description: error.message, variant: 'destructive' })
    },
  })

  const declineMutation = trpc.invitations.decline.useMutation({
    onSuccess: () => {
      toast({ description: t('invitations.declined') })
      utils.invitations.listForAccount.invalidate()
    },
    onError: (error) => {
      toast({ description: error.message, variant: 'destructive' })
    },
  })

  const invitations = invitationsQuery.data?.invitations ?? []

  if (invitationsQuery.isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('invitations.title')}</CardTitle>
          <CardDescription>{t('invitations.description')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 py-1">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    )
  }

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
              invitation.invitedBy?.email ||
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
                      href={`/groups/${groupId}`}
                      className="font-medium text-foreground no-underline outline-hidden focus-visible:underline before:absolute before:inset-0 before:rounded-md before:content-['']"
                      title={
                        invitation.group?.name ?? t('invitations.unknownGroup')
                      }
                    >
                      {invitation.group?.name ?? t('invitations.unknownGroup')}
                    </Link>
                  ) : (
                    <p className="font-medium text-foreground truncate">
                      {invitation.group?.name ?? t('invitations.unknownGroup')}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t('invitations.invitedBy', { name: inviterName })}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t('invitations.sentOn', {
                      date: formatDate(invitation.createdAt, locale),
                    })}
                  </p>
                </div>
                <div className="flex gap-2 sm:shrink-0 relative z-10">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={declineMutation.isPending}
                    onClick={() =>
                      declineMutation.mutate({ invitationId: invitation.id })
                    }
                  >
                    <X className="w-4 h-4 mr-1" />
                    {t('invitations.decline')}
                  </Button>
                  <Button
                    size="sm"
                    disabled={acceptMutation.isPending}
                    onClick={() =>
                      acceptMutation.mutate({ invitationId: invitation.id })
                    }
                  >
                    <Check className="w-4 h-4 mr-1" />
                    {t('invitations.accept')}
                    <ArrowRight className="w-4 h-4 ml-1" />
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

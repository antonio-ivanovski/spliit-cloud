'use client'

import { GroupTabs } from '@/app/groups/[groupId]/group-tabs'
import Link from '@/components/link'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/use-toast'
import { useTranslations } from '@/i18n/react'
import { useRouter } from '@/lib/navigation'
import { trpc } from '@/trpc/client'
import { Check, X } from 'lucide-react'
import { useCurrentGroup } from './current-group-context'

export const GroupHeader = () => {
  const { isLoading, groupId, group, currentInvitation } = useCurrentGroup()
  const tGroups = useTranslations('Groups')
  const { toast } = useToast()
  const router = useRouter()
  const utils = trpc.useUtils()

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

  return (
    <div className="flex flex-col justify-between gap-3">
      <h1 className="font-bold text-2xl">
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
          <AlertDescription className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span>{tGroups('invitationBannerDescription')}</span>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() =>
                  acceptMutation.mutate({
                    invitationId: currentInvitation.id,
                  })
                }
                disabled={acceptMutation.isPending || declineMutation.isPending}
              >
                <Check className="w-4 h-4 mr-2" />
                {tGroups('invitationAccept')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  declineMutation.mutate({
                    invitationId: currentInvitation.id,
                  })
                }
                disabled={acceptMutation.isPending || declineMutation.isPending}
              >
                <X className="w-4 h-4 mr-2" />
                {tGroups('invitationDecline')}
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {!currentInvitation && (
        <div className="flex flex-col gap-3">
          <GroupTabs groupId={groupId} />
        </div>
      )}
    </div>
  )
}

import { GroupForm } from '@/components/group-form'
import { useToast } from '@/components/ui/use-toast'
import { useRouter } from '@/lib/navigation'
import { trpc } from '@/trpc/client'
import { useTranslation } from 'react-i18next'

export const CreateGroup = () => {
  const { t } = useTranslation(undefined, { keyPrefix: 'Groups' })
  const { mutateAsync: createGroup } = trpc.groups.create.useMutation()
  const utils = trpc.useUtils()
  const router = useRouter()
  const { toast } = useToast()

  return (
    <GroupForm
      onSubmit={async (groupFormValues) => {
        const { groupId } = await createGroup({ groupFormValues })
        await Promise.all([
          utils.account.groups.invalidate(),
          utils.invitations.listForAccount.invalidate(),
        ])
        // Invite happens in the Members tab once the group exists. Surface
        // a hint so the user knows to head there next.
        toast({ description: t('createdInviteHint') })
        router.push({
          to: '/groups/$groupId/members',
          params: { groupId },
        })
      }}
    />
  )
}

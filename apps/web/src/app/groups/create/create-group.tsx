import { GroupForm } from '@/components/group-form'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import { useRouter } from '@/lib/navigation'
import { trpc } from '@/trpc/client'
import { ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export const CreateGroup = () => {
  const { t } = useTranslation(undefined, { keyPrefix: 'Groups' })
  const { t: tCommon } = useTranslation(undefined, { keyPrefix: 'Header' })
  const utils = trpc.useUtils()
  const { mutateAsync: createGroup } = trpc.groups.create.useMutation({
    onSuccess: () => {
      utils.account.groups.invalidate()
      utils.invitations.listForAccount.invalidate()
    },
  })
  const router = useRouter()
  const { toast } = useToast()

  function handleBack() {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back()
    } else {
      router.replace({ href: '/' })
    }
  }

  return (
    <>
      <h1 className="text-2xl font-semibold flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="-ml-2"
          onClick={handleBack}
          title={tCommon('back')}
          aria-label={tCommon('back')}
        >
          <ArrowLeft className="w-5 h-5" />
        </Button>
        {t('createGroupCard.title')}
      </h1>
      <GroupForm
        onSubmit={async (groupFormValues) => {
          const { groupId } = await createGroup({ groupFormValues })
          // Invite happens in the Members tab once the group exists. Surface
          // a hint so the user knows to head there next.
          toast({ description: t('createdInviteHint') })
          router.push({
            to: '/groups/$groupId/members',
            params: { groupId },
          })
        }}
      />
    </>
  )
}

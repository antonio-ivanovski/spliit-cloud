import { useNavigate } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { GroupForm } from '@/components/group-form'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import { invalidateAccountGroupLists } from '@/lib/invalidate-account-groups'
import { trpc } from '@/trpc/client'

export const CreateGroup = () => {
  const { t } = useTranslation(undefined, { keyPrefix: 'Groups' })
  const { t: tCommon } = useTranslation(undefined, { keyPrefix: 'Header' })
  const utils = trpc.useUtils()
  const { mutateAsync: createGroup } = trpc.groups.create.useMutation({
    onSuccess: () => {
      void invalidateAccountGroupLists(utils)
      void utils.invitations.listForAccount.invalidate()
    },
  })
  const navigate = useNavigate()
  const { toast } = useToast()

  function handleBack() {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      window.history.back()
    } else {
      void navigate({ to: '/', replace: true })
    }
  }

  return (
    <>
      <h1 className="hidden items-center gap-2 text-2xl font-semibold sm:flex">
        <Button
          variant="ghost"
          size="icon"
          className="-ms-2"
          onClick={handleBack}
          title={tCommon('back')}
          aria-label={tCommon('back')}
        >
          <ArrowLeft className="h-5 w-5 rtl:rotate-180" />
        </Button>
        {t('createGroupCard.title')}
      </h1>
      <GroupForm
        onSubmit={async (groupFormValues) => {
          const { groupId } = await createGroup({ groupFormValues })
          // Invite happens in the Members tab once the group exists. Surface
          // a hint so the user knows to head there next.
          toast({ description: t('createdInviteHint'), variant: 'success' })
          await navigate({
            to: '/groups/$groupId/members',
            params: { groupId },
          })
        }}
      />
    </>
  )
}

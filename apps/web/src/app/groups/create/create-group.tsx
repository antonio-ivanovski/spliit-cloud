import { useNavigate } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { GroupForm } from '@/components/group-form'
import { useMascotController } from '@/components/mascot/mascot-context'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import { invalidateAccountGroupLists } from '@/lib/invalidate-account-groups'
import { useIdempotentCreate } from '@/lib/use-idempotent-create'
import { trpc } from '@/trpc/client'

export const CreateGroup = () => {
  const { t } = useTranslation(undefined, { keyPrefix: 'Groups' })
  const { t: tCommon } = useTranslation(undefined, { keyPrefix: 'Header' })
  const utils = trpc.useUtils()
  const mascot = useMascotController()
  const { mutateAsync: createGroup } = trpc.groups.create.useMutation({
    onSuccess: () => {
      mascot.react('success')
      void invalidateAccountGroupLists(utils)
      void utils.invitations.listForAccount.invalidate()
    },
    onError: () => {
      mascot.react('failure')
    },
  })
  const navigate = useNavigate()
  const { toast } = useToast()
  const createAttempt = useIdempotentCreate()

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
          const result = await createAttempt.run((requestId) =>
            createGroup({ requestId, groupFormValues }),
          )
          if (!result) return
          const { groupId } = result
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

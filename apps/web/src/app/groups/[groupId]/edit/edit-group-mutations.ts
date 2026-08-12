import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { useMascotController } from '@/components/mascot/mascot-context'
import { useToast } from '@/components/ui/use-toast'
import { invalidateAccountGroupLists } from '@/lib/invalidate-account-groups'
import { trpc } from '@/trpc/client'

function useArchiveTranslations() {
  const { t } = useTranslation(undefined, { keyPrefix: 'Groups' })
  return {
    archiveSuccess: t('archiveSuccess'),
    unarchiveSuccess: t('unarchiveSuccess'),
  }
}

function useDeleteTranslations() {
  const { t } = useTranslation(undefined, { keyPrefix: 'Groups' })
  return {
    deletedToast: t('delete.toast.deleted'),
  }
}

export function useUpdateGroupMutation() {
  const utils = trpc.useUtils()
  return trpc.groups.update.useMutation({
    onSuccess: () => utils.groups.invalidate(),
  })
}

export function useArchiveGroupMutation({
  onUnsettledBalances,
}: {
  onUnsettledBalances: () => void
}) {
  const utils = trpc.useUtils()
  const { toast } = useToast()
  const labels = useArchiveTranslations()
  const mascot = useMascotController()

  return trpc.groups.archive.useMutation({
    onSuccess: async (_data, variables) => {
      if (variables.archived) mascot.react('acknowledge')
      await Promise.all([
        invalidateAccountGroupLists(utils),
        utils.groups.get.invalidate({ groupId: variables.groupId }),
      ])
      toast({
        description: variables.archived
          ? labels.archiveSuccess
          : labels.unarchiveSuccess,
      })
    },
    onError: (error) => {
      const code = (error as { data?: { code?: string } } | null)?.data?.code
      if (code === 'PRECONDITION_FAILED') {
        onUnsettledBalances()
        return
      }
      toast({ description: error.message, variant: 'destructive' })
    },
  })
}

export function useDeleteGroupMutation() {
  const utils = trpc.useUtils()
  const navigate = useNavigate()
  const { toast } = useToast()
  const labels = useDeleteTranslations()
  const mascot = useMascotController()

  return trpc.groups.delete.useMutation({
    onSuccess: async () => {
      mascot.react('acknowledge')
      toast({ description: labels.deletedToast })
      await invalidateAccountGroupLists(utils)
      await navigate({ to: '/', replace: true })
    },
    onError: (error) => {
      toast({ description: error.message, variant: 'destructive' })
    },
  })
}

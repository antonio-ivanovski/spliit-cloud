import { useToast } from '@/components/ui/use-toast'
import { trpc } from '@/trpc/client'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

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

  return trpc.groups.archive.useMutation({
    onSuccess: async (_data, variables) => {
      await Promise.all([
        utils.account.groups.invalidate(),
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

  return trpc.groups.delete.useMutation({
    onSuccess: async () => {
      toast({ description: labels.deletedToast })
      await utils.account.groups.invalidate()
      navigate({ to: '/', replace: true })
    },
    onError: (error) => {
      toast({ description: error.message, variant: 'destructive' })
    },
  })
}

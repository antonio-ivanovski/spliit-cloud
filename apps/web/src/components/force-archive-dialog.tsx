import { useNavigate } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
import { useToast } from '@/components/ui/use-toast'
import { invalidateAccountGroupLists } from '@/lib/invalidate-account-groups'
import { trpc } from '@/trpc/client'

type Props = {
  /**
   * When non-null, the dialog is open and the user is being asked to confirm
   * archiving the group identified by this id. The dialog manages the
   * `force-archive` mutation and invalidates the queries that the group page
   * relies on.
   */
  groupId: string | null
  onClose: () => void
}

export function ForceArchiveDialog({ groupId, onClose }: Props) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Groups' })
  const { mutateAsync: archiveGroup } = trpc.groups.archive.useMutation()
  const utils = trpc.useUtils()
  const { toast } = useToast()
  const navigate = useNavigate()
  const [pending, setPending] = useState(false)

  if (!groupId) return null

  // Capture the narrowed value so the nested handlers below can use a
  // guaranteed-non-null id without TypeScript control-flow losing the
  // narrowing across the function boundary.
  const openGroupId = groupId

  async function handleForceArchive() {
    if (!openGroupId) return
    setPending(true)
    try {
      await archiveGroup({
        groupId: openGroupId,
        archived: true,
        force: true,
      })
      await Promise.all([
        invalidateAccountGroupLists(utils),
        utils.groups.get.invalidate({ groupId: openGroupId }),
      ])
      toast({ description: t('archiveWithBalancesSuccess') })
      onClose()
    } catch (error) {
      toast({
        description:
          error instanceof Error
            ? error.message
            : t('archiveWithBalancesCancel'),
        variant: 'destructive',
      })
    } finally {
      setPending(false)
    }
  }

  function handleViewBalances() {
    if (!openGroupId) return
    onClose()
    void navigate({
      to: '/groups/$groupId/balances',
      params: { groupId: openGroupId },
    })
  }

  return (
    <ResponsiveDialog
      open={!!groupId}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            {t('archiveWithBalancesTitle')}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {t('archiveWithBalancesDescription')}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={onClose}
          >
            {t('archiveWithBalancesCancel')}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={handleViewBalances}
          >
            {t('archiveWithBalancesView')}
          </Button>
          <Button type="button" disabled={pending} onClick={handleForceArchive}>
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('archiveWithBalancesForce')}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}

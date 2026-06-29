import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useToast } from '@/components/ui/use-toast'
import { useRouter } from '@/lib/navigation'
import { trpc } from '@/trpc/client'
import { Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

type Props = {
  /**
   * When non-null, the dialog is open and the user is being asked to confirm
   * archiving the group identified by this id. The dialog manages the
   * `force-archive` mutation and invalidates the queries that the group
   * page relies on.
   */
  groupId: string | null
  onClose: () => void
}

export function ForceArchiveDialog({ groupId, onClose }: Props) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Groups' })
  const { mutateAsync: archiveGroup } = trpc.groups.archive.useMutation()
  const utils = trpc.useUtils()
  const { toast } = useToast()
  const router = useRouter()
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
        utils.account.groups.invalidate(),
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
    router.push({
      to: '/groups/$groupId/balances',
      params: { groupId: openGroupId },
    })
  }

  return (
    <Dialog
      open={!!groupId}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('archiveWithBalancesTitle')}</DialogTitle>
          <DialogDescription>
            {t('archiveWithBalancesDescription')}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-end">
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
            {pending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {t('archiveWithBalancesForce')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

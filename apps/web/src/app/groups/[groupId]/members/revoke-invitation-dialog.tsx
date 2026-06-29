import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { useTranslation } from 'react-i18next'

export function RevokeInvitationDialog({
  invitationPendingRevoke,
  revokePreviewQuery,
  revokeSettleChecked,
  revokeMutation,
  onOpenChange,
  onConfirmRevoke,
  onSettleCheckedChange,
}: {
  invitationPendingRevoke: { id: string; email: string; label: string } | null
  revokePreviewQuery: {
    data?: { hasUnsettledBalance?: boolean } | null
    isLoading: boolean
  }
  revokeSettleChecked: boolean
  revokeMutation: { isPending: boolean }
  onOpenChange: (open: boolean) => void
  onConfirmRevoke: () => void
  onSettleCheckedChange: (checked: boolean) => void
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Members' })

  return (
    <Dialog open={!!invitationPendingRevoke} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {revokePreviewQuery.data?.hasUnsettledBalance
              ? t('invitations.revokeDialog.unsettled.title')
              : t('invitations.revokeDialog.title')}
          </DialogTitle>
          <DialogDescription>
            {invitationPendingRevoke
              ? revokePreviewQuery.data?.hasUnsettledBalance
                ? t('invitations.revokeDialog.unsettled.description', {
                    email: invitationPendingRevoke.label,
                  })
                : t('invitations.revokeDialog.description', {
                    email: invitationPendingRevoke.label,
                  })
              : null}
          </DialogDescription>
        </DialogHeader>

        {revokePreviewQuery.isLoading ? (
          <div className="flex flex-col gap-2 py-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : revokePreviewQuery.data?.hasUnsettledBalance ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2 rounded-md border border-amber-500/40 bg-amber-50 dark:bg-amber-950/30 p-3">
              <p className="text-sm font-medium">
                {t('invitations.revokeDialog.unsettled.warning.title')}
              </p>
              <p className="text-sm text-muted-foreground">
                {t('invitations.revokeDialog.unsettled.warning.description')}
              </p>
            </div>
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <Checkbox
                checked={revokeSettleChecked}
                onCheckedChange={(checked) =>
                  onSettleCheckedChange(checked === true)
                }
                disabled={revokeMutation.isPending}
                className="mt-0.5"
              />
              <span>{t('invitations.revokeDialog.unsettled.checkbox')}</span>
            </label>
          </div>
        ) : null}

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={revokeMutation.isPending}
          >
            {t('invitations.revokeDialog.cancel')}
          </Button>
          <Button
            variant="destructive"
            onClick={() => onConfirmRevoke()}
            disabled={
              revokeMutation.isPending ||
              revokePreviewQuery.isLoading ||
              (revokePreviewQuery.data?.hasUnsettledBalance === true &&
                !revokeSettleChecked)
            }
          >
            {t('invitations.revokeDialog.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

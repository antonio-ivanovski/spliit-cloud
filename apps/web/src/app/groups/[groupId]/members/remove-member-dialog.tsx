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

export function RemoveMemberDialog({
  memberPendingRemove,
  removePreviewQuery,
  removeSettleChecked,
  removeMemberMutation,
  onOpenChange,
  onConfirmRemove,
  onSettleCheckedChange,
}: {
  memberPendingRemove: { id: string; name: string } | null
  removePreviewQuery: {
    data?: { hasUnsettledBalance?: boolean } | null
    isLoading: boolean
  }
  removeSettleChecked: boolean
  removeMemberMutation: { isPending: boolean }
  onOpenChange: (open: boolean) => void
  onConfirmRemove: (settleBalances?: boolean) => void
  onSettleCheckedChange: (checked: boolean) => void
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Members' })

  return (
    <Dialog open={!!memberPendingRemove} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {removePreviewQuery.data?.hasUnsettledBalance
              ? t('removeDialog.unsettled.title')
              : t('removeDialog.title')}
          </DialogTitle>
          <DialogDescription>
            {memberPendingRemove
              ? removePreviewQuery.data?.hasUnsettledBalance
                ? t('removeDialog.unsettled.description', {
                    name: memberPendingRemove.name,
                  })
                : t('removeDialog.description', {
                    name: memberPendingRemove.name,
                  })
              : null}
          </DialogDescription>
        </DialogHeader>

        {removePreviewQuery.isLoading ? (
          <div className="flex flex-col gap-2 py-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : removePreviewQuery.data?.hasUnsettledBalance ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2 rounded-md border border-amber-500/40 bg-amber-50 dark:bg-amber-950/30 p-3">
              <p className="text-sm font-medium">
                {t('removeDialog.unsettled.warning.title')}
              </p>
              <p className="text-sm text-muted-foreground">
                {t('removeDialog.unsettled.warning.description')}
              </p>
              <label className="flex items-start gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={removeSettleChecked}
                  onCheckedChange={(checked) =>
                    onSettleCheckedChange(checked === true)
                  }
                  disabled={removeMemberMutation.isPending}
                  className="mt-0.5"
                />
                <span>{t('removeDialog.unsettled.checkbox')}</span>
              </label>
            </div>
          </div>
        ) : null}

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={removeMemberMutation.isPending}
          >
            {t('removeDialog.cancel')}
          </Button>
          <Button
            variant="destructive"
            onClick={() =>
              onConfirmRemove(
                removePreviewQuery.data?.hasUnsettledBalance
                  ? removeSettleChecked
                  : undefined,
              )
            }
            disabled={
              removeMemberMutation.isPending || removePreviewQuery.isLoading
            }
          >
            {t('removeDialog.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

import { Button } from '@/components/ui/button'
import { useTranslation } from 'react-i18next'

type VisualSplitConflictBannerProps = {
  editable: boolean
  hasAllocation: boolean
  allocationTarget: number
  selectedCount: number
  resizeConflict: boolean
  onScaleToTotal: () => void
}

export function VisualSplitConflictBanner({
  editable,
  hasAllocation,
  allocationTarget,
  selectedCount,
  resizeConflict,
  onScaleToTotal,
}: VisualSplitConflictBannerProps) {
  const { t } = useTranslation(undefined, {
    keyPrefix: 'ExpenseForm.VisualSplit',
  })
  if (!editable) return null
  return (
    <>
      {allocationTarget < selectedCount && (
        <p className="mb-3 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
          {t('unavailableAmount')}
        </p>
      )}
      {resizeConflict && hasAllocation && (
        <div
          className="mb-3 flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2"
          role="alert"
        >
          <p className="text-sm text-destructive">{t('allocationConflict')}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onScaleToTotal}
          >
            {t('scaleToTotal')}
          </Button>
        </div>
      )}
    </>
  )
}

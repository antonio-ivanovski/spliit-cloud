import { Button } from '@/components/ui/button'
import { useTranslation } from 'react-i18next'

type VisualSplitHeaderProps = {
  readOnly: boolean
  editable: boolean
  hasAllocation: boolean
  selectedCount: number
  participantCount: number
  selectAllLabel?: string
  onSelectAll: () => void
  onResetEqually: () => void
}

export function VisualSplitHeader({
  readOnly,
  editable,
  hasAllocation,
  selectedCount,
  participantCount,
  selectAllLabel,
  onSelectAll,
  onResetEqually,
}: VisualSplitHeaderProps) {
  const { t } = useTranslation(undefined, {
    keyPrefix: 'ExpenseForm.VisualSplit',
  })
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {t('participants')}
      </span>
      {!readOnly && (
        <div className="flex items-center gap-1">
          {selectedCount < participantCount && selectAllLabel && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onSelectAll}
            >
              {selectAllLabel}
            </Button>
          )}
          {editable && hasAllocation && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onResetEqually}
            >
              {t('resetEqually')}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

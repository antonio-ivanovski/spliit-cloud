import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useTranslation } from 'react-i18next'
import { DEFAULT_SHARE_TOTAL_PRESETS } from '../allocation-engine'

type VisualSplitSharesControlProps = {
  readOnly: boolean
  selectedCount: number
  shareTotal: number
  shareTargetInput: string
  onShareTargetInputChange: (value: string) => void
  onShareTargetInputFocus: () => void
  onShareTargetInputBlur: () => void
  onShareTargetInputKeyDown: (
    event: React.KeyboardEvent<HTMLInputElement>,
  ) => void
  onPresetClick: (preset: number) => void
}

export function VisualSplitSharesControl({
  readOnly,
  selectedCount,
  shareTotal,
  shareTargetInput,
  onShareTargetInputChange,
  onShareTargetInputFocus,
  onShareTargetInputBlur,
  onShareTargetInputKeyDown,
  onPresetClick,
}: VisualSplitSharesControlProps) {
  const { t } = useTranslation(undefined, {
    keyPrefix: 'ExpenseForm.VisualSplit',
  })
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {t('shares')}
      </span>
      <div className="flex items-center gap-1.5">
        {DEFAULT_SHARE_TOTAL_PRESETS.map((preset) => (
          <Button
            key={preset}
            type="button"
            size="sm"
            variant={shareTotal === preset ? 'secondary' : 'outline'}
            className="h-8 min-w-10 rounded-full px-2.5 tabular-nums"
            disabled={readOnly || preset < selectedCount}
            aria-pressed={shareTotal === preset}
            onClick={() => onPresetClick(preset)}
          >
            {preset}
          </Button>
        ))}
        <Input
          className="h-8 w-16 rounded-full px-2 text-center tabular-nums"
          type="number"
          min={selectedCount}
          step={1}
          value={shareTargetInput}
          disabled={readOnly}
          aria-label={`${t('shares')} total`}
          onChange={(event) => onShareTargetInputChange(event.target.value)}
          onFocus={(event) => {
            onShareTargetInputFocus()
            event.currentTarget.select()
          }}
          onBlur={onShareTargetInputBlur}
          onKeyDown={onShareTargetInputKeyDown}
        />
      </div>
    </div>
  )
}

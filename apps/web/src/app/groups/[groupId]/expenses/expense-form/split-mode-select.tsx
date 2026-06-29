import { FormDescription } from '@/components/ui/form'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { SplitMode } from '@spliit/domain'

export function SplitModeSelect({
  value,
  onValueChange,
  readOnly,
  t,
  descriptionKey,
}: {
  value: SplitMode
  onValueChange: (next: SplitMode) => void
  readOnly: boolean
  t: (key: string, opts?: Record<string, unknown>) => string
  descriptionKey: string
}) {
  return (
    <>
      <Select
        onValueChange={(next) => onValueChange(next as SplitMode)}
        defaultValue={value}
        disabled={readOnly}
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="EVENLY">{t('SplitModeField.evenly')}</SelectItem>
          <SelectItem value="BY_SHARES">
            {t('SplitModeField.byShares')}
          </SelectItem>
          <SelectItem value="BY_PERCENTAGE">
            {t('SplitModeField.byPercentage')}
          </SelectItem>
          <SelectItem value="BY_AMOUNT">
            {t('SplitModeField.byAmount')}
          </SelectItem>
        </SelectContent>
      </Select>
      <FormDescription>{t(descriptionKey)}</FormDescription>
    </>
  )
}

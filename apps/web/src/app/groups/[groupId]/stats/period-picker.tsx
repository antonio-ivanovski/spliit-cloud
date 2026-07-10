import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { CalendarRange } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { StatsCustomRange, StatsPeriod } from './dashboard-types'

const periods: Array<StatsPeriod> = [
  'LATEST_ACTIVITY',
  'WEEK',
  'MONTH',
  'QUARTER',
  'YEAR',
  'CUSTOM',
]

type Props = {
  value: StatsPeriod
  onValueChange: (period: StatsPeriod) => void
  customRange: StatsCustomRange | null
  onCustomRangeChange: (range: StatsCustomRange) => void
}

export function StatsPeriodPicker({
  value,
  onValueChange,
  customRange,
  onCustomRangeChange,
}: Props) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Stats.Dashboard' })

  return (
    <div className="rounded-lg border bg-muted/40 p-1">
      <div className="flex flex-wrap gap-1">
        {periods.map((period) => (
          <Button
            key={period}
            size="sm"
            variant="ghost"
            aria-pressed={value === period}
            className={cn(
              'h-8 px-2.5 text-xs text-muted-foreground',
              value === period &&
                'bg-background text-foreground shadow-xs hover:bg-background',
            )}
            onClick={() => onValueChange(period)}
          >
            {period === 'CUSTOM' && <CalendarRange className="size-3.5" />}
            {t(`periods.${period}`)}
          </Button>
        ))}
      </div>
      {value === 'CUSTOM' && customRange && (
        <div className="mt-1 grid gap-1 border-t px-1 pt-2 sm:grid-cols-2">
          <label className="grid gap-1 text-[11px] font-medium text-muted-foreground">
            {t('customRange.from')}
            <Input
              className="date-base h-8 bg-background text-xs"
              type="date"
              value={customRange.from}
              onChange={(event) =>
                onCustomRangeChange({
                  from: event.target.value,
                  to:
                    event.target.value > customRange.to
                      ? event.target.value
                      : customRange.to,
                })
              }
            />
          </label>
          <label className="grid gap-1 text-[11px] font-medium text-muted-foreground">
            {t('customRange.to')}
            <Input
              className="date-base h-8 bg-background text-xs"
              type="date"
              value={customRange.to}
              onChange={(event) =>
                onCustomRangeChange({
                  from:
                    event.target.value < customRange.from
                      ? event.target.value
                      : customRange.from,
                  to: event.target.value,
                })
              }
            />
          </label>
        </div>
      )}
    </div>
  )
}

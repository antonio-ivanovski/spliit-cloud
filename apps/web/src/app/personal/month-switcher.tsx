import { ChevronLeft, ChevronRight } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useLocale } from '@/i18n/react'

import {
  currentPersonalMonth,
  personalMonthLabel,
  shiftPersonalMonth,
} from './month'
import { usePersonalTranslation } from './personal-i18n'

type Props = {
  month: string
  onChange: (month: string) => void
  /** Upper bound for "next" navigation (defaults to the current month). */
  maxMonth?: string
}

/**
 * Month switcher bound to the `?month=YYYY-MM` search param. Previous/next step
 * one calendar month; the "today" affordance jumps back to the current month.
 * Next is disabled past `maxMonth` so users cannot page into the future beyond
 * this month.
 */
export function MonthSwitcher({ month, onChange, maxMonth }: Props) {
  const { t } = usePersonalTranslation()
  const locale = useLocale()
  const nowMonth = currentPersonalMonth()
  const upper = maxMonth ?? nowMonth
  const canGoNext = month < upper
  const isCurrent = month === nowMonth

  return (
    <div
      className="flex items-center justify-between gap-2"
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- pager buttons with a static label; not a form field group
      role="group"
      aria-label={t('overview.monthSwitcher')}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => onChange(shiftPersonalMonth(month, -1))}
        aria-label={t('overview.previousMonth')}
      >
        <ChevronLeft className="size-4 rtl:rotate-180" aria-hidden="true" />
      </Button>
      <div className="flex min-w-0 items-center gap-2">
        <p className="truncate text-base font-semibold tracking-tight sm:text-lg">
          {personalMonthLabel(month, locale, nowMonth)}
        </p>
        {!isCurrent && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 px-2 text-xs"
            onClick={() => onChange(nowMonth)}
          >
            {t('overview.thisMonth')}
          </Button>
        )}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => onChange(shiftPersonalMonth(month, 1))}
        disabled={!canGoNext}
        aria-label={t('overview.nextMonth')}
      >
        <ChevronRight className="size-4 rtl:rotate-180" aria-hidden="true" />
      </Button>
    </div>
  )
}

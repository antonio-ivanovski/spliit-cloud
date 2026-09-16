import type { Dayjs } from 'dayjs'
import { ChevronDown, ChevronUp, EyeOff } from 'lucide-react'
import { forwardRef, Fragment, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ScanStickyHeading } from '@/components/layout/scan-surface'
import { Skeleton } from '@/components/ui/skeleton'
import {
  calendarDay,
  isInCurrentLocaleWeek,
  isInPreviousLocaleWeek,
} from '@/lib/calendar'
import { cn, dateOnlyIso, zonedDateOnlyIso } from '@/lib/utils'

export const EXPENSE_GROUPS = {
  UPCOMING: 'upcoming',
  TODAY: 'today',
  THIS_WEEK: 'thisWeek',
  PREVIOUS_WEEK: 'previousWeek',
  EARLIER_THIS_MONTH: 'earlierThisMonth',
  LAST_MONTH: 'lastMonth',
  EARLIER_THIS_YEAR: 'earlierThisYear',
  LAST_YEAR: 'lastYear',
  OLDER: 'older',
} as const

type ExpenseGroup = (typeof EXPENSE_GROUPS)[keyof typeof EXPENSE_GROUPS]

const EXPENSE_GROUP_I18N_KEYS = {
  upcoming: 'Groups.upcoming',
  today: 'Groups.today',
  thisWeek: 'Groups.thisWeek',
  previousWeek: 'Groups.previousWeek',
  earlierThisMonth: 'Groups.earlierThisMonth',
  lastMonth: 'Groups.lastMonth',
  earlierThisYear: 'Groups.earlierThisYear',
  lastYear: 'Groups.lastYear',
  older: 'Groups.older',
} as const satisfies Record<ExpenseGroup, string>

type TimelineExpense = {
  id: string
  expenseDate: Date | string
  expenseTimeZone: string
}

function getExpenseGroup(
  date: Dayjs,
  today: Dayjs,
  locale: string,
): ExpenseGroup {
  if (today.isBefore(date)) {
    return EXPENSE_GROUPS.UPCOMING
  } else if (today.isSame(date, 'day')) {
    return EXPENSE_GROUPS.TODAY
  } else if (isInCurrentLocaleWeek(date, today, locale)) {
    return EXPENSE_GROUPS.THIS_WEEK
  } else if (isInPreviousLocaleWeek(date, today, locale)) {
    return EXPENSE_GROUPS.PREVIOUS_WEEK
  } else if (today.isSame(date, 'month')) {
    return EXPENSE_GROUPS.EARLIER_THIS_MONTH
  } else if (today.subtract(1, 'month').isSame(date, 'month')) {
    return EXPENSE_GROUPS.LAST_MONTH
  } else if (today.isSame(date, 'year')) {
    return EXPENSE_GROUPS.EARLIER_THIS_YEAR
  } else if (today.subtract(1, 'year').isSame(date, 'year')) {
    return EXPENSE_GROUPS.LAST_YEAR
  } else {
    return EXPENSE_GROUPS.OLDER
  }
}

export function getGroupedExpensesByDate<T extends TimelineExpense>(
  expenses: T[],
  timeZone: string,
  locale = 'en-US',
  now = new Date(),
) {
  const today = calendarDay(zonedDateOnlyIso(now, timeZone))
  const expenseGroupValues = Object.values(EXPENSE_GROUPS) as ExpenseGroup[]
  const result = Object.fromEntries(
    expenseGroupValues.map((group) => [group, [] as T[]]),
  ) as Record<ExpenseGroup, T[]>

  for (const expense of expenses) {
    let iso: string
    try {
      iso = zonedDateOnlyIso(
        new Date(expense.expenseDate),
        expense.expenseTimeZone,
      )
    } catch {
      iso = dateOnlyIso(new Date(expense.expenseDate))
    }
    const expenseGroup = getExpenseGroup(calendarDay(iso), today, locale)
    result[expenseGroup].push(expense)
  }

  return result
}
const FLAT_GROUP_KEY = '__all'

type ExpenseRun<T> = { type: 'visible' | 'hidden'; items: T[] }

/**
 * Splits an ordered expense list into consecutive same-visibility runs, so
 * hidden expenses collapse inline at their chronological position instead of
 * being lumped into a single block at the end of the group.
 */
function splitRuns<T>(
  expenses: T[],
  isInvolving: (expense: T) => boolean,
): ExpenseRun<T>[] {
  const runs: ExpenseRun<T>[] = []
  for (const expense of expenses) {
    const type = isInvolving(expense) ? 'visible' : 'hidden'
    const last = runs[runs.length - 1]
    if (last !== undefined && last.type === type) {
      last.items.push(expense)
    } else {
      runs.push({ type, items: [expense] })
    }
  }
  return runs
}

export function ExpenseTimeline<T extends TimelineExpense>({
  expenses,
  sortBy,
  timeZone,
  hasMore,
  loadingRef,
  renderExpense,
  /**
   * Decides whether an expense involves the viewer. When `showAll` is false,
   * expenses failing this check collapse behind inline per-run "hidden" rows.
   * Defaults to showing everything (used by timelines without identity).
   */
  isInvolving,
  showAll = true,
}: {
  expenses: T[]
  sortBy: 'expenseDate' | 'createdAt' | 'amount'
  timeZone: string
  hasMore: boolean
  loadingRef?: React.Ref<HTMLDivElement>
  renderExpense: (expense: T) => React.ReactNode
  isInvolving?: (expense: T) => boolean
  showAll?: boolean
}) {
  const { t, i18n } = useTranslation(undefined, { keyPrefix: 'Expenses' })
  const locale = i18n.language || 'en-US'
  const useDateGrouping = sortBy === 'expenseDate'
  const collapseHidden =
    !showAll && isInvolving !== undefined && expenses.length > 0
  const isInvolvingFn = isInvolving ?? (() => true)
  // Per-run expansion is ephemeral UI state (not in the URL): each run is
  // keyed by the group plus its first hidden expense id, so it survives
  // infinite-scroll appends and resets naturally on remount. It also resets
  // when the view mode flips, so the incoming mode always starts from its
  // canonical state (runs collapsed in "For you", everything visible in
  // "All") instead of inheriting stale expansion.
  const [expandedRuns, setExpandedRuns] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  const prevShowAll = useRef(showAll)
  useEffect(() => {
    if (prevShowAll.current !== showAll) {
      prevShowAll.current = showAll
      setExpandedRuns(new Set())
    }
  }, [showAll])
  const toggleRun = (runKey: string) => {
    setExpandedRuns((prev) => {
      const next = new Set(prev)
      if (next.has(runKey)) next.delete(runKey)
      else next.add(runKey)
      return next
    })
  }

  const renderRuns = (groupKey: string, groupExpenses: T[]) => {
    const runs = splitRuns(groupExpenses, isInvolvingFn)
    let hiddenRunIndex = -1
    return runs.map((run) => {
      if (run.type === 'visible') {
        return run.items.map((expense) => renderExpense(expense))
      }
      hiddenRunIndex += 1
      const runKey = `${groupKey}:${run.items[0].id}`
      const expanded = expandedRuns.has(runKey)
      return (
        <Fragment key={runKey}>
          <HiddenExpensesToggle
            testId={`hidden-expenses-toggle-${groupKey}-${hiddenRunIndex}`}
            hiddenCount={run.items.length}
            expanded={expanded}
            onToggle={() => toggleRun(runKey)}
          />
          {expanded && run.items.map((expense) => renderExpense(expense))}
        </Fragment>
      )
    })
  }

  if (!useDateGrouping) {
    return (
      <>
        <div className="motion-stagger">
          {collapseHidden
            ? renderRuns(FLAT_GROUP_KEY, expenses)
            : expenses.map((expense) => renderExpense(expense))}
        </div>
        {hasMore && <ExpensesLoading ref={loadingRef} />}
      </>
    )
  }

  const groupedExpenses = getGroupedExpensesByDate(expenses, timeZone, locale)

  return (
    <>
      {Object.values(EXPENSE_GROUPS).map((expenseGroup) => {
        const groupExpenses = groupedExpenses[expenseGroup]
        if (groupExpenses.length === 0) return null

        return (
          <div key={expenseGroup} className="motion-stagger">
            <ScanStickyHeading>
              {t(EXPENSE_GROUP_I18N_KEYS[expenseGroup])}
            </ScanStickyHeading>
            {collapseHidden
              ? renderRuns(expenseGroup, groupExpenses)
              : groupExpenses.map((expense) => renderExpense(expense))}
          </div>
        )
      })}
      {hasMore && <ExpensesLoading ref={loadingRef} />}
    </>
  )
}

function HiddenExpensesToggle({
  testId,
  hiddenCount,
  expanded,
  onToggle,
}: {
  testId: string
  hiddenCount: number
  expanded: boolean
  onToggle: () => void
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Expenses' })
  const Chevron = expanded ? ChevronUp : ChevronDown

  return (
    <button
      type="button"
      aria-expanded={expanded}
      data-testid={testId}
      onClick={onToggle}
      className={cn(
        'flex w-full cursor-pointer items-center gap-1.5 px-4 py-2.5 text-xs text-muted-foreground',
        'hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden sm:px-6',
      )}
    >
      <EyeOff className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="flex-1 text-start">
        {expanded
          ? t('hiddenExpensesShowLess')
          : t('hiddenExpenses', { count: hiddenCount })}
      </span>
      <Chevron className="h-3 w-3 shrink-0" aria-hidden="true" />
    </button>
  )
}

export const ExpensesLoading = forwardRef<HTMLDivElement>((_, ref) => {
  return (
    <div ref={ref}>
      <Skeleton className="mx-4 mt-1 mb-2 h-3 w-32 rounded-full sm:mx-6" />
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="flex items-start justify-between gap-2 px-2 py-4 text-sm sm:px-6"
        >
          <div className="flex-0 ps-2 pe-1">
            <Skeleton className="h-4 w-4 rounded-full" />
          </div>
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-16 rounded-full" />
            <Skeleton className="h-4 w-32 rounded-full" />
          </div>
          <div className="me-2 flex flex-0 flex-col items-end gap-2 sm:me-12">
            <Skeleton className="h-4 w-16 rounded-full" />
            <Skeleton className="h-4 w-20 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  )
})
ExpensesLoading.displayName = 'ExpensesLoading'

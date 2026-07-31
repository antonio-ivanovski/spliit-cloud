import dayjs, { type Dayjs } from 'dayjs'
import { forwardRef } from 'react'
import { useTranslation } from 'react-i18next'

import { Skeleton } from '@/components/ui/skeleton'
import { dateOnlyIso, zonedDateOnlyIso } from '@/lib/utils'

export const EXPENSE_GROUPS = {
  UPCOMING: 'upcoming',
  THIS_WEEK: 'thisWeek',
  EARLIER_THIS_MONTH: 'earlierThisMonth',
  LAST_MONTH: 'lastMonth',
  EARLIER_THIS_YEAR: 'earlierThisYear',
  LAST_YEAR: 'lastYear',
  OLDER: 'older',
} as const

type ExpenseGroup = (typeof EXPENSE_GROUPS)[keyof typeof EXPENSE_GROUPS]

const EXPENSE_GROUP_I18N_KEYS = {
  upcoming: 'Groups.upcoming',
  thisWeek: 'Groups.thisWeek',
  earlierThisMonth: 'Groups.earlierThisMonth',
  lastMonth: 'Groups.lastMonth',
  earlierThisYear: 'Groups.earlierThisYear',
  lastYear: 'Groups.lastYear',
  older: 'Groups.older',
} as const satisfies Record<ExpenseGroup, string>

type TimelineExpense = {
  id: string
  expenseDate: Date | string
}

function getExpenseGroup(date: Dayjs, today: Dayjs): ExpenseGroup {
  if (today.isBefore(date)) {
    return EXPENSE_GROUPS.UPCOMING
  } else if (today.isSame(date, 'week')) {
    return EXPENSE_GROUPS.THIS_WEEK
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

function calendarDay(value: string) {
  return dayjs(`${value}T12:00:00`)
}

export function getGroupedExpensesByDate<T extends TimelineExpense>(
  expenses: T[],
  timeZone: string,
) {
  const today = calendarDay(zonedDateOnlyIso(new Date(), timeZone))
  const expenseGroupValues = Object.values(EXPENSE_GROUPS) as ExpenseGroup[]
  const result = Object.fromEntries(
    expenseGroupValues.map((group) => [group, [] as T[]]),
  ) as Record<ExpenseGroup, T[]>

  for (const expense of expenses) {
    const expenseGroup = getExpenseGroup(
      calendarDay(dateOnlyIso(new Date(expense.expenseDate))),
      today,
    )
    result[expenseGroup].push(expense)
  }

  return result
}

export function ExpenseTimeline<T extends TimelineExpense>({
  expenses,
  sortBy,
  timeZone,
  hasMore,
  loadingRef,
  renderExpense,
}: {
  expenses: T[]
  sortBy: 'expenseDate' | 'createdAt' | 'amount'
  timeZone: string
  hasMore: boolean
  loadingRef?: React.Ref<HTMLDivElement>
  renderExpense: (expense: T) => React.ReactNode
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Expenses' })
  const useDateGrouping = sortBy === 'expenseDate'

  if (!useDateGrouping) {
    return (
      <>
        <div className="motion-stagger">
          {expenses.map((expense) => renderExpense(expense))}
        </div>
        {hasMore && <ExpensesLoading ref={loadingRef} />}
      </>
    )
  }

  const groupedExpenses = getGroupedExpensesByDate(expenses, timeZone)

  return (
    <>
      {Object.values(EXPENSE_GROUPS).map((expenseGroup) => {
        const groupExpenses = groupedExpenses[expenseGroup]
        if (groupExpenses.length === 0) return null

        return (
          <div key={expenseGroup} className="motion-stagger">
            <div className="sticky top-(--app-header-height) bg-white py-1 pl-4 text-xs font-semibold text-muted-foreground sm:pl-6 dark:bg-[#1b1917]">
              {t(EXPENSE_GROUP_I18N_KEYS[expenseGroup])}
            </div>
            {groupExpenses.map((expense) => renderExpense(expense))}
          </div>
        )
      })}
      {hasMore && <ExpensesLoading ref={loadingRef} />}
    </>
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
          <div className="flex-0 pr-1 pl-2">
            <Skeleton className="h-4 w-4 rounded-full" />
          </div>
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-16 rounded-full" />
            <Skeleton className="h-4 w-32 rounded-full" />
          </div>
          <div className="mr-2 flex flex-0 flex-col items-end gap-2 sm:mr-12">
            <Skeleton className="h-4 w-16 rounded-full" />
            <Skeleton className="h-4 w-20 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  )
})
ExpensesLoading.displayName = 'ExpensesLoading'

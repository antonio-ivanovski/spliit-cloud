import dayjs, { type Dayjs } from 'dayjs'
import { forwardRef, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useInView } from 'react-intersection-observer'
import { useDebounce } from 'use-debounce'

import { ExpenseCard } from '@/app/groups/[groupId]/expenses/expense-card'
import {
  ExpenseFiltersProvider,
  useExpenseFiltersContext,
} from '@/app/groups/[groupId]/expenses/expense-filters-context'
import {
  ExpenseListFilterChips,
  ExpenseListFiltersPanel,
  ExpenseListToolbar,
} from '@/app/groups/[groupId]/expenses/expense-list-toolbar'
import {
  DEFAULT_FILTERS,
  DEFAULT_SORT,
  useExpenseFilters,
} from '@/app/groups/[groupId]/expenses/use-expense-filters'
import { useSyncedAccountPreferences } from '@/components/account-preferences-sync'
import Link from '@/components/link'
import { Button } from '@/components/ui/button'
import { SearchBar } from '@/components/ui/search-bar'
import { Skeleton } from '@/components/ui/skeleton'
import { detectDeviceTimeZone } from '@/lib/account-preferences'
import {
  dateOnlyIso,
  getCurrencyFromGroup,
  zonedDateOnlyIso,
} from '@/lib/utils'
import { trpc } from '@/trpc/client'
import type { AppRouterOutput } from '@spliit/api/router'

import { useCurrentGroup, useIsPendingInvitee } from '../current-group-context'
import { useLinkInviteToken } from '../use-link-invite-token'
import { EXPENSE_LIST_PAGE_SIZE } from './expense-list-query'

type ExpensesType = AppRouterOutput['groups']['expenses']['list']['expenses']

const EXPENSE_GROUPS = {
  UPCOMING: 'upcoming',
  THIS_WEEK: 'thisWeek',
  EARLIER_THIS_MONTH: 'earlierThisMonth',
  LAST_MONTH: 'lastMonth',
  EARLIER_THIS_YEAR: 'earlierThisYear',
  LAST_YEAR: 'lastYear',
  OLDER: 'older',
} as const

const EXPENSE_GROUP_I18N_KEYS = {
  upcoming: 'Groups.upcoming',
  thisWeek: 'Groups.thisWeek',
  earlierThisMonth: 'Groups.earlierThisMonth',
  lastMonth: 'Groups.lastMonth',
  earlierThisYear: 'Groups.earlierThisYear',
  lastYear: 'Groups.lastYear',
  older: 'Groups.older',
} as const satisfies Record<
  (typeof EXPENSE_GROUPS)[keyof typeof EXPENSE_GROUPS],
  string
>

function getExpenseGroup(date: Dayjs, today: Dayjs) {
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

function getGroupedExpensesByDate(expenses: ExpensesType, timeZone: string) {
  const today = calendarDay(zonedDateOnlyIso(new Date(), timeZone))
  const expenseGroupValues = Object.values(EXPENSE_GROUPS) as Array<
    (typeof EXPENSE_GROUPS)[keyof typeof EXPENSE_GROUPS]
  >
  const result = Object.fromEntries(
    expenseGroupValues.map((g) => [g, [] as ExpensesType]),
  ) as Record<
    (typeof EXPENSE_GROUPS)[keyof typeof EXPENSE_GROUPS],
    ExpensesType
  >
  for (const expense of expenses) {
    const expenseGroup = getExpenseGroup(
      calendarDay(dateOnlyIso(expense.expenseDate)),
      today,
    )
    result[expenseGroup].push(expense)
  }
  return result
}

export function ExpenseList() {
  const { groupId } = useCurrentGroup()
  const linkInviteToken = useLinkInviteToken()
  const [searchText, setSearchText] = useState('')
  const [debouncedSearchText] = useDebounce(searchText, 300)
  const filtersApi = useExpenseFilters(groupId)

  return (
    <ExpenseFiltersProvider value={filtersApi}>
      <div className="mx-4 flex flex-col gap-2 py-2 sm:mx-6 sm:flex-row sm:items-center">
        <SearchBar
          containerClassName="flex-1"
          onValueChange={(value) => setSearchText(value)}
        />
        <ExpenseListToolbar />
      </div>
      <ExpenseListFiltersPanel />
      <ExpenseListFilterChips className="mx-4 mb-2 sm:mx-6" />
      <ExpenseListForSearch
        groupId={groupId}
        searchText={debouncedSearchText}
        linkInviteToken={linkInviteToken}
      />
    </ExpenseFiltersProvider>
  )
}

const ExpenseListForSearch = ({
  groupId,
  searchText,
  linkInviteToken,
}: {
  groupId: string
  searchText: string
  linkInviteToken: string | undefined
}) => {
  const { group } = useCurrentGroup()
  const accountPreferences = useSyncedAccountPreferences()
  const accountTimeZone =
    accountPreferences?.timeZone ?? detectDeviceTimeZone() ?? 'UTC'
  const isPendingInvitee = useIsPendingInvitee()

  const { queryInput, sort, activeCount, setFilters } =
    useExpenseFiltersContext()
  const { t } = useTranslation(undefined, { keyPrefix: 'Expenses' })
  const { t: tFilters } = useTranslation(undefined, {
    keyPrefix: 'Expenses.filters',
  })
  const { ref: loadingRef, inView } = useInView()

  const hasActiveFiltersOrSort =
    activeCount > 0 ||
    sort.sortBy !== DEFAULT_SORT.sortBy ||
    sort.sortDir !== DEFAULT_SORT.sortDir

  const {
    data,
    isLoading: expensesAreLoading,
    fetchNextPage,
  } = trpc.groups.expenses.list.useInfiniteQuery(
    {
      groupId,
      limit: EXPENSE_LIST_PAGE_SIZE,
      filter: searchText,
      linkInviteToken,
      ...queryInput,
    },
    { getNextPageParam: ({ nextCursor }) => nextCursor },
  )
  const expenses = data?.pages.flatMap((page) => page.expenses)
  const hasMore = data?.pages.at(-1)?.hasMore ?? false

  const isLoading = expensesAreLoading || !expenses || !group

  useEffect(() => {
    if (inView && hasMore && !isLoading) void fetchNextPage()
  }, [fetchNextPage, hasMore, inView, isLoading])

  // Date grouping only applies when the user is sorting by expense
  // date. Sorting by amount or created-at contradicts bucketing by
  // date, so the list renders flat for those orders.
  const useDateGrouping = sort.sortBy === 'expenseDate'

  const groupedExpensesByDate = useMemo<
    Record<(typeof EXPENSE_GROUPS)[keyof typeof EXPENSE_GROUPS], ExpensesType>
  >(
    () =>
      expenses && useDateGrouping
        ? getGroupedExpensesByDate(expenses, accountTimeZone)
        : getGroupedExpensesByDate([], accountTimeZone),
    [accountTimeZone, expenses, useDateGrouping],
  )

  if (isLoading) return <ExpensesLoading />

  if (expenses.length === 0)
    return (
      <div className="px-6 py-6 text-sm">
        {hasActiveFiltersOrSort ? (
          <div className="flex flex-col gap-2">
            <p className="font-semibold">{tFilters('noMatchTitle')}</p>
            <p className="text-muted-foreground">{tFilters('noMatchBody')}</p>
            <div>
              <Button
                variant="link"
                className="-m-4"
                onClick={() => setFilters(DEFAULT_FILTERS)}
              >
                {tFilters('noMatchClear')}
              </Button>
            </div>
          </div>
        ) : (
          <p>
            {t('noExpenses')}{' '}
            {group.archived || isPendingInvitee ? null : (
              <Button variant="link" asChild className="-m-4">
                <Link href={`/groups/${groupId}/expenses/create`}>
                  {t('createFirst')}
                </Link>
              </Button>
            )}
          </p>
        )}
      </div>
    )

  if (!useDateGrouping) {
    return (
      <>
        <div className="motion-stagger">
          {expenses.map((expense) => (
            <ExpenseCard
              key={expense.id}
              expense={expense}
              currency={getCurrencyFromGroup(group)}
              groupId={groupId}
              participantCount={group.participants.length}
            />
          ))}
        </div>
        {hasMore && <ExpensesLoading ref={loadingRef} />}
      </>
    )
  }

  return (
    <>
      {Object.values(EXPENSE_GROUPS).map((expenseGroup) => {
        const groupExpenses = groupedExpensesByDate[expenseGroup]
        if (!groupExpenses || groupExpenses.length === 0) return null

        return (
          <div key={expenseGroup} className="motion-stagger">
            <div
              className={
                'sticky top-(--app-header-height) bg-white py-1 pl-4 text-xs font-semibold text-muted-foreground sm:pl-6 dark:bg-[#1b1917]'
              }
            >
              {t(EXPENSE_GROUP_I18N_KEYS[expenseGroup])}
            </div>
            {groupExpenses.map((expense) => (
              <ExpenseCard
                key={expense.id}
                expense={expense}
                currency={getCurrencyFromGroup(group)}
                groupId={groupId}
                participantCount={group.participants.length}
              />
            ))}
          </div>
        )
      })}
      {hasMore && <ExpensesLoading ref={loadingRef} />}
    </>
  )
}

const ExpensesLoading = forwardRef<HTMLDivElement>((_, ref) => {
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

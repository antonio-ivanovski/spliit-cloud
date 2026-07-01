import { ExpenseCard } from '@/app/groups/[groupId]/expenses/expense-card'
import Link from '@/components/link'
import { Button } from '@/components/ui/button'
import { SearchBar } from '@/components/ui/search-bar'
import { Skeleton } from '@/components/ui/skeleton'
import { getCurrencyFromGroup } from '@/lib/utils'
import { trpc } from '@/trpc/client'
import type { AppRouterOutput } from '@spliit/api/router'
import dayjs, { type Dayjs } from 'dayjs'
import { forwardRef, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useInView } from 'react-intersection-observer'
import { useDebounce } from 'use-debounce'
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

function getGroupedExpensesByDate(expenses: ExpensesType) {
  const today = dayjs()
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
    const expenseGroup = getExpenseGroup(dayjs(expense.expenseDate), today)
    result[expenseGroup].push(expense)
  }
  return result
}

export function ExpenseList() {
  const { groupId } = useCurrentGroup()
  const linkInviteToken = useLinkInviteToken()
  const [searchText, setSearchText] = useState('')
  const [debouncedSearchText] = useDebounce(searchText, 300)

  return (
    <>
      <SearchBar onValueChange={(value) => setSearchText(value)} />
      <ExpenseListForSearch
        groupId={groupId}
        searchText={debouncedSearchText}
        linkInviteToken={linkInviteToken}
      />
    </>
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
  const isPendingInvitee = useIsPendingInvitee()

  const { t } = useTranslation(undefined, { keyPrefix: 'Expenses' })
  const { ref: loadingRef, inView } = useInView()

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
    },
    { getNextPageParam: ({ nextCursor }) => nextCursor },
  )
  const expenses = data?.pages.flatMap((page) => page.expenses)
  const hasMore = data?.pages.at(-1)?.hasMore ?? false

  const isLoading = expensesAreLoading || !expenses || !group

  useEffect(() => {
    if (inView && hasMore && !isLoading) fetchNextPage()
  }, [fetchNextPage, hasMore, inView, isLoading])

  const groupedExpensesByDate = useMemo<
    Record<(typeof EXPENSE_GROUPS)[keyof typeof EXPENSE_GROUPS], ExpensesType>
  >(
    () =>
      expenses
        ? getGroupedExpensesByDate(expenses)
        : getGroupedExpensesByDate([]),
    [expenses],
  )

  if (isLoading) return <ExpensesLoading />

  if (expenses.length === 0)
    return (
      <p className="px-6 text-sm py-6">
        {t('noExpenses')}{' '}
        {group.archived || isPendingInvitee ? null : (
          <Button variant="link" asChild className="-m-4">
            <Link href={`/groups/${groupId}/expenses/create`}>
              {t('createFirst')}
            </Link>
          </Button>
        )}
      </p>
    )

  return (
    <>
      {Object.values(EXPENSE_GROUPS).map((expenseGroup) => {
        const groupExpenses = groupedExpensesByDate[expenseGroup]
        if (!groupExpenses || groupExpenses.length === 0) return null

        return (
          <div key={expenseGroup}>
            <div
              className={
                'text-muted-foreground text-xs pl-4 sm:pl-6 py-1 font-semibold sticky top-16 bg-white dark:bg-[#1b1917]'
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
      <Skeleton className="mx-4 sm:mx-6 mt-1 mb-2 h-3 w-32 rounded-full" />
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="flex justify-between items-start px-2 sm:px-6 py-4 text-sm gap-2"
        >
          <div className="flex-0 pl-2 pr-1">
            <Skeleton className="h-4 w-4 rounded-full" />
          </div>
          <div className="flex-1 flex flex-col gap-2">
            <Skeleton className="h-4 w-16 rounded-full" />
            <Skeleton className="h-4 w-32 rounded-full" />
          </div>
          <div className="flex-0 flex flex-col gap-2 items-end mr-2 sm:mr-12">
            <Skeleton className="h-4 w-16 rounded-full" />
            <Skeleton className="h-4 w-20 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  )
})
ExpensesLoading.displayName = 'ExpensesLoading'

import { useEffect, useState } from 'react'
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
import { detectDeviceTimeZone } from '@/lib/account-preferences'
import { getCurrencyFromGroup } from '@/lib/utils'
import { trpc } from '@/trpc/client'

import { useCurrentGroup, useIsPendingInvitee } from '../current-group-context'
import { useLinkInviteToken } from '../use-link-invite-token'
import { EXPENSE_LIST_PAGE_SIZE } from './expense-list-query'
import { ExpenseTimeline, ExpensesLoading } from './expense-timeline'

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
              <Button
                variant="link"
                className="-m-4 hidden sm:inline-flex"
                render={<Link href={`/groups/${groupId}/expenses/create`} />}
              >
                {t('createFirst')}
              </Button>
            )}
          </p>
        )}
      </div>
    )

  return (
    <ExpenseTimeline
      expenses={expenses}
      sortBy={sort.sortBy}
      timeZone={accountTimeZone}
      hasMore={hasMore}
      loadingRef={loadingRef}
      renderExpense={(expense) => (
        <ExpenseCard
          key={expense.id}
          expense={expense}
          currency={getCurrencyFromGroup(group)}
          groupId={groupId}
          participantCount={group.participants.length}
        />
      )}
    />
  )
}

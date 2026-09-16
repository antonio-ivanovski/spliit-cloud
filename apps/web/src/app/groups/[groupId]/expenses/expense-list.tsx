import { keepPreviousData } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
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
  shouldPageByInvolvement,
  useExpenseFilters,
} from '@/app/groups/[groupId]/expenses/use-expense-filters'
import { useRenderedViewMode } from '@/app/groups/[groupId]/expenses/use-rendered-view-mode'
import { useSyncedAccountPreferences } from '@/components/account-preferences-sync'
import { OfflineEmptyState } from '@/components/offline-empty-state'
import { Button } from '@/components/ui/button'
import { SearchBar } from '@/components/ui/search-bar'
import { useLocale } from '@/i18n/react'
import { detectDeviceTimeZone } from '@/lib/account-preferences'
import { useActiveUser } from '@/lib/hooks'
import { useCurrentAccount } from '@/lib/use-current-account'
import { useOfflineWithoutData } from '@/lib/use-online-status'
import { getCurrencyFromGroup } from '@/lib/utils'
import { trpc } from '@/trpc/client'

import {
  useCurrentGroup,
  useIsReadOnlyGroupViewer,
} from '../current-group-context'
import { useGroupAccessSearch } from '../use-group-access-search'
import {
  isExpenseInvolvingUser,
  type InvolvementExpense,
} from './expense-involvement'
import { EXPENSE_LIST_PAGE_SIZE } from './expense-list-query'
import { ExpenseTimeline, ExpensesLoading } from './expense-timeline'

export function ExpenseList() {
  const { groupId } = useCurrentGroup()
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
      />
    </ExpenseFiltersProvider>
  )
}

const ExpenseListForSearch = ({
  groupId,
  searchText,
}: {
  groupId: string
  searchText: string
}) => {
  const { group } = useCurrentGroup()
  const { linkInviteToken, viewKey } = useGroupAccessSearch()
  const accountPreferences = useSyncedAccountPreferences()
  const accountTimeZone =
    accountPreferences?.timeZone ?? detectDeviceTimeZone() ?? 'UTC'
  const isReadOnlyGroupViewer = useIsReadOnlyGroupViewer()

  const { queryInput, filters, sort, activeCount, setFilters } =
    useExpenseFiltersContext()
  const { t } = useTranslation(undefined, { keyPrefix: 'Expenses' })
  const { t: tFilters } = useTranslation(undefined, {
    keyPrefix: 'Expenses.filters',
  })
  const locale = useLocale()
  const { ref: loadingRef, inView } = useInView()
  // Involvement can only be determined for members with a ledger participant
  // id. Everyone else (logged-out viewers, pending invitees) sees everything
  // and gets no toggle.
  const participantId = useActiveUser(groupId)
  const { data: account } = useCurrentAccount()
  const canCollapse = participantId != null
  const showAll = filters.showAll || !canCollapse
  const isInvolving = (expense: InvolvementExpense) =>
    isExpenseInvolvingUser(expense, participantId, account?.id ?? null)

  const hasActiveFiltersOrSort =
    activeCount > 0 ||
    sort.sortBy !== DEFAULT_SORT.sortBy ||
    sort.sortDir !== DEFAULT_SORT.sortDir

  const {
    data,
    isLoading: expensesAreLoading,
    isPlaceholderData,
    fetchNextPage,
    refetch,
  } = trpc.groups.expenses.list.useInfiniteQuery(
    {
      groupId,
      limit: EXPENSE_LIST_PAGE_SIZE,
      filter: searchText,
      locale,
      linkInviteToken,
      viewKey,
      ...queryInput,
      // Mirror the collapse UI: when hidden runs render, page around
      // involving expenses so each page holds a meaningful row count.
      hideNotInvolving: shouldPageByInvolvement(canCollapse, filters.showAll)
        ? true
        : undefined,
    },
    {
      getNextPageParam: ({ nextCursor }) => nextCursor,
      // Keep the current rows on screen while a mode switch refetches.
      // `useRenderedViewMode` below freezes the timeline's mode to match
      // those stale rows, so the swap happens in one clean step.
      placeholderData: keepPreviousData,
    },
  )
  const expenses = data?.pages.flatMap((page) => page.expenses)
  const hasMore = data?.pages.at(-1)?.hasMore ?? false
  const showOfflineEmpty = useOfflineWithoutData(!!data)
  // While a mode switch refetches, render the stale rows under their own
  // (previous) mode so the list never flashes a half-state.
  const renderedShowAll = useRenderedViewMode(showAll, isPlaceholderData)

  const isLoading = expensesAreLoading || !expenses || !group

  useEffect(() => {
    if (inView && hasMore && !isLoading) void fetchNextPage()
  }, [fetchNextPage, hasMore, inView, isLoading])

  if (showOfflineEmpty) {
    return (
      <div className="px-4 sm:px-6">
        <OfflineEmptyState variant="plain" onRetry={() => void refetch()} />
      </div>
    )
  }

  if (isLoading) return <ExpensesLoading />

  if (expenses.length === 0)
    return (
      <div className="px-4 py-6 text-sm sm:px-6">
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
            {group.archived || isReadOnlyGroupViewer ? null : (
              <Button
                variant="link"
                className="-m-4 hidden sm:inline-flex"
                nativeButton={false}
                render={
                  <Link
                    to="/groups/$groupId/expenses/create"
                    params={{ groupId }}
                  />
                }
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
      isInvolving={isInvolving}
      showAll={renderedShowAll}
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

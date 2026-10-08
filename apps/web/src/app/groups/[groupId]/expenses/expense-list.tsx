import { Link } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
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
import { ApiErrorEmptyState } from '@/components/api-error-empty-state'
import { OfflineEmptyState } from '@/components/offline-empty-state'
import { Button } from '@/components/ui/button'
import { SearchBar } from '@/components/ui/search-bar'
import { useLocale } from '@/i18n/react'
import { detectDeviceTimeZone } from '@/lib/account-preferences'
import { useRestoreExpenseEditScroll } from '@/lib/expense-edit-scroll'
import { useActiveUser } from '@/lib/hooks'
import { useOfflineExpenses } from '@/lib/offline/read-hooks'
import { useCurrentAccount } from '@/lib/use-current-account'
import {
  useOfflineWithoutData,
  useServerUnreachableWithoutData,
} from '@/lib/use-online-status'
import { getCurrencyFromGroup } from '@/lib/utils'

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

type ListExpense = InvolvementExpense & {
  id: string
  expenseDate: Date | string
  expenseTimeZone: string
  createdAt: Date | string
  amount: number
} & Record<string, unknown>

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
  const { t: tOffline } = useTranslation()
  const locale = useLocale()
  const { ref: loadingRef, inView } = useInView()
  // Involvement can only be determined for members with a ledger participant
  // id. Everyone else (logged-out viewers, pending invitees) sees everything
  // and gets no toggle.
  const participantId = useActiveUser(groupId)
  const { data: account } = useCurrentAccount()
  const canCollapse = participantId != null
  const showAll = filters.showAll || !canCollapse
  // Stable callbacks so memoized cards bail out when unrelated rows merge.
  // Captures only the identity inputs; the expense object itself stays the
  // hook's merged reference (local reused when unchanged).
  const accountId = account?.id ?? null
  const isInvolving = useCallback(
    (expense: InvolvementExpense) =>
      isExpenseInvolvingUser(expense, participantId, accountId),
    [participantId, accountId],
  )

  const hasActiveFiltersOrSort =
    activeCount > 0 ||
    sort.sortBy !== DEFAULT_SORT.sortBy ||
    sort.sortDir !== DEFAULT_SORT.sortDir

  // Single source: the unified offline-first hook owns the network query
  // internally and merges live rows over cached rows in place. No second
  // network subscription here (previously a duplicate `useInfiniteQuery`).
  // Local keys stay disjoint (`['offline', ...]`); merge happens in the
  // selector, never by writing snapshots into live pages.
  const merged = useOfflineExpenses({
    groupId,
    limit: EXPENSE_LIST_PAGE_SIZE,
    linkInviteToken,
    viewKey,
    enabled: group !== undefined,
    filter: {
      hideSettlements: queryInput.hideSettlements,
      categories: queryInput.categories,
      paidBy: queryInput.paidBy,
      paidByMatch: queryInput.paidByMatch,
      paidFor: queryInput.paidFor,
      paidForMatch: queryInput.paidForMatch,
      dateFrom: queryInput.dateFrom,
      dateTo: queryInput.dateTo,
      minAmount: queryInput.minAmount,
      maxAmount: queryInput.maxAmount,
      currencies: queryInput.currencies,
      search: searchText,
      locale,
    },
    sortBy: sort.sortBy,
    sortDir: sort.sortDir,
    collapseInvolving: shouldPageByInvolvement(canCollapse, filters.showAll),
  })
  type MergedExpenses = ListExpense[]
  const mergedPages = merged.data?.pages
  const expenses = useMemo(
    () =>
      mergedPages?.flatMap((page) => page.expenses) as
        | MergedExpenses
        | undefined,
    [mergedPages],
  )
  const hasMore = merged.hasMore
  const mergedMeta = merged.meta
  const hasReadableData = !!merged.data
  const showOfflineEmpty =
    useOfflineWithoutData(hasReadableData) &&
    mergedMeta.availability !== 'ready'
  const showServerEmpty = useServerUnreachableWithoutData(hasReadableData)
  const fetchNextPageUnified = merged.fetchNextPage
  const refetch = merged.refetch
  // While a mode switch refetches, render the stale rows under their own
  // (previous) mode so the list never flashes a half-state. `refreshing`
  // covers both network-only and merged refetches.
  const isPlaceholderData =
    mergedMeta.refreshing && !!expenses && expenses.length > 0
  const renderedShowAll = useRenderedViewMode(showAll, isPlaceholderData)

  const isLoading = merged.isLoading || !expenses || !group

  const currency = useMemo(
    () =>
      group
        ? getCurrencyFromGroup(group as never)
        : getCurrencyFromGroup({ currency: 'USD' } as never),
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- group object identity changes per render; depend on stable currency fields only.
    [group?.currency, group?.currencyCode],
  )
  const participantCount = group?.participants.length ?? 0
  const renderExpense = useCallback(
    (expense: ListExpense) => (
      <ExpenseCard
        key={expense.id}
        expense={expense as never}
        currency={currency}
        groupId={groupId}
        participantCount={participantCount}
      />
    ),
    [currency, groupId, participantCount],
  )

  useRestoreExpenseEditScroll(
    !isLoading && !showServerEmpty && !showOfflineEmpty,
    groupId,
  )

  useEffect(() => {
    // Serialize infinite-scroll prefetches: without the `refreshing` gate a
    // short list keeps the sentinel in view and fires concurrent
    // `fetchNextPage` calls on every render, merging pages in quick
    // succession (visible re-refresh). One page at a time settles instead.
    if (inView && hasMore && !isLoading && !mergedMeta.refreshing)
      void fetchNextPageUnified()
  }, [fetchNextPageUnified, hasMore, inView, isLoading, mergedMeta.refreshing])

  if (showServerEmpty) {
    return (
      <div className="px-4 sm:px-6">
        <ApiErrorEmptyState variant="plain" onRetry={() => void refetch()} />
      </div>
    )
  }

  if (showOfflineEmpty) {
    // No network pages and no complete local snapshot: honest missing state.
    // A missing group snapshot shows the download hint via the layout shell;
    // this list stays generic to avoid duplicate banners.
    return (
      <div className="px-4 sm:px-6">
        <OfflineEmptyState variant="plain" onRetry={() => void refetch()} />
      </div>
    )
  }

  if (isLoading || !expenses || !group) return <ExpensesLoading />

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
    // Stable list viewport: a minimum height keeps the page footer and the
    // infinite-scroll sentinel from jumping while pages merge in, and
    // `aria-busy` marks background refetches so they never read as a reload.
    <div className="min-h-[30vh]" aria-busy={mergedMeta.refreshing}>
      {mergedMeta.source === 'download' && mergedMeta.hasMore && (
        <output className="mx-4 mb-2 block text-xs text-muted-foreground sm:mx-6">
          {tOffline('OfflineReadOnly.dataUnavailable')}
        </output>
      )}
      <ExpenseTimeline<ListExpense>
        expenses={expenses}
        sortBy={sort.sortBy}
        timeZone={accountTimeZone}
        hasMore={hasMore}
        loadingRef={loadingRef}
        isInvolving={isInvolving}
        showAll={renderedShowAll}
        renderExpense={renderExpense}
      />
    </div>
  )
}

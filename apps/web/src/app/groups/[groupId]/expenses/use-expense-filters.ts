import { useNavigate, useSearch } from '@tanstack/react-router'
import { useCallback, useMemo, useState } from 'react'

export type ExpenseSortBy = 'expenseDate' | 'createdAt' | 'amount'
export type ExpenseSortDir = 'asc' | 'desc'
export type ExpenseMatchMode = 'any' | 'all' | 'exact'

export type ExpenseFilters = {
  showSettlements: boolean
  categories: string[]
  paidBy: string[]
  paidByMatch: ExpenseMatchMode
  paidFor: string[]
  paidForMatch: ExpenseMatchMode
  dateFrom: string | undefined
  dateTo: string | undefined
  minAmount: string | undefined
  maxAmount: string | undefined
  currencies: string[]
}

export type ExpenseSort = {
  sortBy: ExpenseSortBy
  sortDir: ExpenseSortDir
}

export type ExpenseQueryInput = {
  hideReimbursements: boolean
  categories?: string[]
  paidBy?: string[]
  paidByMatch?: ExpenseMatchMode
  paidFor?: string[]
  paidForMatch?: ExpenseMatchMode
  dateFrom?: Date
  dateTo?: Date
  minAmount?: number
  maxAmount?: number
  currencies?: string[]
  sortBy?: ExpenseSortBy
  sortDir?: ExpenseSortDir
}

export const DEFAULT_FILTERS: ExpenseFilters = {
  showSettlements: true,
  categories: [],
  paidBy: [],
  paidByMatch: 'any',
  paidFor: [],
  paidForMatch: 'any',
  dateFrom: undefined,
  dateTo: undefined,
  minAmount: undefined,
  maxAmount: undefined,
  currencies: [],
}

export const DEFAULT_SORT: ExpenseSort = {
  sortBy: 'expenseDate',
  sortDir: 'desc',
}

function splitCsv(value: string | undefined): string[] {
  if (!value) return []
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

function joinCsv(arr: string[]): string | undefined {
  const filtered = arr.filter((entry) => entry.length > 0)
  return filtered.length === 0 ? undefined : filtered.join(',')
}

function readFiltersFromSearch(search: Record<string, unknown>): {
  filters: ExpenseFilters
  sort: ExpenseSort
} {
  const filters: ExpenseFilters = {
    showSettlements: search.expShowSettlements !== 'false',
    categories: splitCsv(search.expCategories as string | undefined),
    paidBy: splitCsv(search.expPaidBy as string | undefined),
    paidByMatch:
      (search.expPaidByMatch as ExpenseMatchMode | undefined) ?? 'any',
    paidFor: splitCsv(search.expPaidFor as string | undefined),
    paidForMatch:
      (search.expPaidForMatch as ExpenseMatchMode | undefined) ?? 'any',
    dateFrom: (search.expDateFrom as string | undefined) || undefined,
    dateTo: (search.expDateTo as string | undefined) || undefined,
    minAmount: (search.expMinAmount as string | undefined) || undefined,
    maxAmount: (search.expMaxAmount as string | undefined) || undefined,
    currencies: splitCsv(search.expCurrencies as string | undefined),
  }
  const sort: ExpenseSort = {
    sortBy: (search.expSortBy as ExpenseSortBy | undefined) ?? 'expenseDate',
    sortDir: (search.expSortDir as ExpenseSortDir | undefined) ?? 'desc',
  }
  return { filters, sort }
}

function buildSearchFromFiltersAndSort(
  currentSearch: Record<string, unknown>,
  filters: ExpenseFilters,
  sort: ExpenseSort,
): Record<string, unknown> {
  // Preserve unrelated keys (e.g. `invite`, `friendLinkInvite`).
  const search: Record<string, unknown> = { ...currentSearch }
  const csvFields: Array<[string, string | undefined]> = [
    ['expCategories', joinCsv(filters.categories)],
    ['expPaidBy', joinCsv(filters.paidBy)],
    ['expPaidFor', joinCsv(filters.paidFor)],
    ['expCurrencies', joinCsv(filters.currencies)],
  ]
  for (const [key, value] of csvFields) {
    if (value === undefined) delete search[key]
    else search[key] = value
  }

  const setOrDelete = (key: string, value: string | undefined) => {
    if (value === undefined || value === '') delete search[key]
    else search[key] = value
  }
  setOrDelete(
    'expPaidByMatch',
    filters.paidByMatch === 'any' ? undefined : filters.paidByMatch,
  )
  setOrDelete(
    'expPaidForMatch',
    filters.paidForMatch === 'any' ? undefined : filters.paidForMatch,
  )
  setOrDelete(
    'expShowSettlements',
    filters.showSettlements === false ? 'false' : undefined,
  )
  setOrDelete('expDateFrom', filters.dateFrom)
  setOrDelete('expDateTo', filters.dateTo)
  setOrDelete('expMinAmount', filters.minAmount)
  setOrDelete('expMaxAmount', filters.maxAmount)
  setOrDelete(
    'expSortBy',
    sort.sortBy === DEFAULT_SORT.sortBy ? undefined : sort.sortBy,
  )
  setOrDelete(
    'expSortDir',
    sort.sortDir === DEFAULT_SORT.sortDir ? undefined : sort.sortDir,
  )

  return search
}

function countActiveFilters(filters: ExpenseFilters): number {
  let count = 0
  if (!filters.showSettlements) count++
  if (filters.categories.length > 0) count++
  if (filters.paidBy.length > 0) count++
  if (filters.paidFor.length > 0) count++
  if (filters.dateFrom || filters.dateTo) count++
  if (filters.minAmount || filters.maxAmount) count++
  if (filters.currencies.length > 0) count++
  return count
}

function numberOrUndefined(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function dateOrUndefined(value: string | undefined): Date | undefined {
  if (!value) return undefined
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed
}

/**
 * Owns the expense-list filter + sort state.
 *
 * - Filters/sort are URL search params (shareable, survive navigation
 *   to/from an expense detail). `showSettlements` is part of the same
 *   draft/apply flow as the other filters — toggling it routes through
 *   `setApplied` so the toolbar reflects the URL state.
 * - `filtersOpen` is ephemeral UI state shared between the toolbar
 *   trigger and the panel so they re-render together. Not persisted, not in
 *   the URL.
 *
 * Returned `queryInput` merges everything into the tRPC
 * `groups.expenses.list` input shape so the parent component can spread
 * it into the query.
 */
export function useExpenseFilters(groupId: string) {
  const search = useSearch({ from: '/groups/$groupId' })
  const navigate = useNavigate({ from: '/groups/$groupId' })

  const { filters, sort } = useMemo(
    () => readFiltersFromSearch(search as Record<string, unknown>),
    [search],
  )

  // Ephemeral UI state shared between the toolbar trigger and the
  // filters panel (inline at all breakpoints).
  const [filtersOpen, setFiltersOpen] = useState(false)

  const activeCount = useMemo(() => countActiveFilters(filters), [filters])

  const setApplied = useCallback(
    (nextFilters: ExpenseFilters, nextSort: ExpenseSort) => {
      const next = buildSearchFromFiltersAndSort(
        search as Record<string, unknown>,
        nextFilters,
        nextSort,
      )
      navigate({
        to: '/groups/$groupId',
        params: { groupId },
        search: next,
        replace: true,
      })
    },
    [groupId, navigate, search],
  )

  const clearOne = useCallback(
    (key: keyof ExpenseFilters | 'paidByMatch' | 'paidForMatch') => {
      const nextFilters: ExpenseFilters = {
        ...filters,
        [key]: undefined as never,
      }
      if (key === 'paidByMatch')
        nextFilters.paidByMatch = DEFAULT_FILTERS.paidByMatch
      if (key === 'paidForMatch')
        nextFilters.paidForMatch = DEFAULT_FILTERS.paidForMatch
      if (key === 'showSettlements')
        nextFilters.showSettlements = DEFAULT_FILTERS.showSettlements
      setApplied(nextFilters, sort)
    },
    [filters, setApplied, sort],
  )

  const setSort = useCallback(
    (nextSort: ExpenseSort) => {
      setApplied(filters, nextSort)
    },
    [filters, setApplied],
  )

  const setFilters = useCallback(
    (nextFilters: ExpenseFilters) => {
      setApplied(nextFilters, sort)
    },
    [setApplied, sort],
  )

  const queryInput: ExpenseQueryInput = useMemo(() => {
    const input: ExpenseQueryInput = {
      hideReimbursements: !filters.showSettlements,
    }
    if (filters.categories.length > 0) input.categories = filters.categories
    if (filters.paidBy.length > 0) {
      input.paidBy = filters.paidBy
      input.paidByMatch = filters.paidByMatch
    }
    if (filters.paidFor.length > 0) {
      input.paidFor = filters.paidFor
      input.paidForMatch = filters.paidForMatch
    }
    const dateFrom = dateOrUndefined(filters.dateFrom)
    if (dateFrom) input.dateFrom = dateFrom
    const dateTo = dateOrUndefined(filters.dateTo)
    if (dateTo) input.dateTo = dateTo
    const minAmount = numberOrUndefined(filters.minAmount)
    if (minAmount !== undefined) input.minAmount = minAmount
    const maxAmount = numberOrUndefined(filters.maxAmount)
    if (maxAmount !== undefined) input.maxAmount = maxAmount
    if (filters.currencies.length > 0) input.currencies = filters.currencies
    if (sort.sortBy !== DEFAULT_SORT.sortBy) input.sortBy = sort.sortBy
    if (sort.sortDir !== DEFAULT_SORT.sortDir) input.sortDir = sort.sortDir
    return input
  }, [filters, sort])

  return {
    filters,
    sort,
    activeCount,
    queryInput,
    setSort,
    setFilters,
    clearOne,
    filtersOpen,
    setFiltersOpen,
  } as const
}

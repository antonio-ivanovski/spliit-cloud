import {
  getRouteApi,
  type LinkProps,
  useNavigate,
} from '@tanstack/react-router'
import { ArrowDownWideNarrow, Filter, Search, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useInView } from 'react-intersection-observer'
import { useDebounce } from 'use-debounce'

import { CurrentGroupProvider } from '@/app/groups/[groupId]/current-group-context'
import { ExpenseCard } from '@/app/groups/[groupId]/expenses/expense-card'
import { ExpensePreviewModal } from '@/app/groups/[groupId]/expenses/expense-preview-modal'
import {
  ExpenseTimeline,
  ExpensesLoading,
} from '@/app/groups/[groupId]/expenses/expense-timeline'
import { categoryLabel } from '@/app/groups/[groupId]/stats/category-utils'
import { useSyncedAccountPreferences } from '@/components/account-preferences-sync'
import { RequireAuth } from '@/components/require-auth'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { DateInput } from '@/components/ui/date-input'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useLocale } from '@/i18n/react'
import { detectDeviceTimeZone } from '@/lib/account-preferences'
import { getCurrency, getCurrencyFromGroup } from '@/lib/currency'
import {
  enforceCurrencyPattern,
  localizeCurrencyInput,
} from '@/lib/currency-input'
import { cn } from '@/lib/utils'
import { trpc } from '@/trpc/client'
import type { AppRouterOutput } from '@spliit/api/router'
import { DEFAULT_CATEGORIES } from '@spliit/domain'

const routeApi = getRouteApi('/expenses')
type GlobalExpense = AppRouterOutput['expenses']['list']['expenses'][number]
type Person = AppRouterOutput['expenses']['filterOptions']['people'][number]
type FilterOptions = AppRouterOutput['expenses']['filterOptions']

type PersonRef =
  | { kind: 'account'; id: string }
  | { kind: 'participant'; id: string; groupId: string }

type Filters = {
  q: string
  groups: string[]
  categories: string[]
  paidBy: PersonRef[]
  paidByMatch: 'any' | 'all' | 'exact'
  paidFor: PersonRef[]
  paidForMatch: 'any' | 'all' | 'exact'
  dateFrom: string
  dateTo: string
  minAmount: string
  maxAmount: string
  currencies: string[]
  showSettlements: boolean
  sortBy: 'expenseDate' | 'createdAt' | 'amount'
  sortDir: 'asc' | 'desc'
}

const splitCsv = (value: string | undefined) =>
  value
    ?.split(',')
    .map((entry) => entry.trim())
    .filter(Boolean) ?? []

function encodePerson(person: PersonRef) {
  return person.kind === 'account'
    ? `a:${person.id}`
    : `p:${person.groupId ?? ''}:${person.id}`
}

function decodePerson(value: string): PersonRef | null {
  const [kind, first, second] = value.split(':')
  if (kind === 'a' && first) return { kind: 'account', id: first }
  if (kind === 'p' && first && second)
    return { kind: 'participant', groupId: first, id: second }
  return null
}

function readFilters(search: Record<string, unknown>): Filters {
  const paidBy = splitCsv(search.paidBy as string | undefined)
    .map(decodePerson)
    .filter((person): person is PersonRef => person !== null)
  const paidFor = splitCsv(search.paidFor as string | undefined)
    .map(decodePerson)
    .filter((person): person is PersonRef => person !== null)
  return {
    q: (search.q as string | undefined) ?? '',
    groups: splitCsv(search.groups as string | undefined),
    categories: splitCsv(search.categories as string | undefined),
    paidBy,
    paidByMatch: (search.paidByMatch as Filters['paidByMatch']) ?? 'any',
    paidFor,
    paidForMatch: (search.paidForMatch as Filters['paidForMatch']) ?? 'any',
    dateFrom: (search.dateFrom as string | undefined) ?? '',
    dateTo: (search.dateTo as string | undefined) ?? '',
    minAmount: (search.minAmount as string | undefined) ?? '',
    maxAmount: (search.maxAmount as string | undefined) ?? '',
    currencies: splitCsv(search.currencies as string | undefined),
    showSettlements: search.showSettlements !== 'false',
    sortBy: (search.sortBy as Filters['sortBy']) ?? 'expenseDate',
    sortDir: (search.sortDir as Filters['sortDir']) ?? 'desc',
  }
}

function filtersToSearch(filters: Filters) {
  const next: Record<string, string | undefined> = {
    q: filters.q.trim() || undefined,
    groups: filters.groups.join(',') || undefined,
    categories: filters.categories.join(',') || undefined,
    paidBy: filters.paidBy.map(encodePerson).join(',') || undefined,
    paidByMatch:
      filters.paidByMatch === 'any' ? undefined : filters.paidByMatch,
    paidFor: filters.paidFor.map(encodePerson).join(',') || undefined,
    paidForMatch:
      filters.paidForMatch === 'any' ? undefined : filters.paidForMatch,
    dateFrom: filters.dateFrom || undefined,
    dateTo: filters.dateTo || undefined,
    minAmount: filters.minAmount || undefined,
    maxAmount: filters.maxAmount || undefined,
    currencies: filters.currencies.join(',') || undefined,
    showSettlements: filters.showSettlements ? undefined : 'false',
    sortBy: filters.sortBy === 'expenseDate' ? undefined : filters.sortBy,
    sortDir: filters.sortDir === 'desc' ? undefined : filters.sortDir,
  }
  return next
}

function amountToMinor(value: string, currencyKey: string | undefined) {
  if (!value || !currencyKey) return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return undefined
  const code = currencyKey.split(':')[0]
  const currency = code ? getCurrency(code) : undefined
  return Math.round(parsed * 10 ** (currency?.decimal_digits ?? 2))
}

function buildGlobalExpensesReturnTo(filters: Filters) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filtersToSearch(filters))) {
    if (value) params.set(key, value)
  }
  const query = params.toString()
  return query ? `/expenses?${query}` : '/expenses'
}

function personKey(person: PersonRef) {
  return encodePerson(person)
}

function samePerson(a: PersonRef, b: PersonRef) {
  return personKey(a) === personKey(b)
}

function GlobalExpenseFilters({
  filters,
  onChange,
  options,
}: {
  filters: Filters
  onChange: (next: Filters) => void
  options: FilterOptions
}) {
  const { t } = useTranslation()
  const locale = useLocale()
  const categories = DEFAULT_CATEGORIES.map((category) => ({
    id: category.id,
    label: categoryLabel(t, category.id),
  }))
  const selectedCurrency = filters.currencies.length === 1
  const selectedCurrencyDetails = selectedCurrency
    ? getCurrency(filters.currencies[0]!.split(':')[0]!)
    : undefined
  const toggle = (
    key: 'groups' | 'categories' | 'currencies',
    value: string,
  ) => {
    const values = filters[key]
    onChange({
      ...filters,
      [key]: values.includes(value)
        ? values.filter((entry) => entry !== value)
        : [...values, value],
    })
  }
  const togglePerson = (key: 'paidBy' | 'paidFor', person: PersonRef) => {
    const values = filters[key]
    onChange({
      ...filters,
      [key]: values.some((entry) => samePerson(entry, person))
        ? values.filter((entry) => !samePerson(entry, person))
        : [...values, person],
    })
  }
  const personValue = (person: Person): PersonRef =>
    person.kind === 'account'
      ? { kind: 'account', id: person.id }
      : { kind: 'participant', id: person.id, groupId: person.groupId! }

  return (
    <div className="flex flex-col gap-5 text-sm">
      <div className="grid gap-4 sm:grid-cols-2">
        <FilterChoice label={t('Expenses.globalGroups')}>
          <div className="flex max-h-40 flex-col gap-2 overflow-auto">
            {options.groups.map((group) => (
              <label key={group.id} className="flex items-center gap-2">
                <Checkbox
                  checked={filters.groups.includes(group.id)}
                  onCheckedChange={() => toggle('groups', group.id)}
                />
                <span
                  className={cn(
                    group.archived || group.hidden
                      ? 'text-muted-foreground'
                      : '',
                  )}
                >
                  {group.displayName}
                  {(group.archived || group.hidden) &&
                    ' · ' + t('Expenses.globalInactive')}
                </span>
              </label>
            ))}
          </div>
        </FilterChoice>
        <FilterChoice label={t('Expenses.filters.category')}>
          <div className="flex max-h-40 flex-wrap content-start gap-2 overflow-auto">
            {categories.map((category) => (
              <button
                key={category.id}
                type="button"
                aria-pressed={filters.categories.includes(category.id)}
                onClick={() => toggle('categories', category.id)}
                className={cn(
                  'rounded-md border px-2 py-1 text-xs',
                  filters.categories.includes(category.id) &&
                    'bg-primary text-primary-foreground',
                )}
              >
                {category.label}
              </button>
            ))}
          </div>
        </FilterChoice>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {(['paidBy', 'paidFor'] as const).map((key) => {
          const matchKey = key === 'paidBy' ? 'paidByMatch' : 'paidForMatch'
          const selected = filters[key]
          return (
            <FilterChoice
              key={key}
              label={
                key === 'paidBy'
                  ? t('Expenses.filters.paidBy')
                  : t('Expenses.filters.paidFor')
              }
            >
              <div className="flex flex-col gap-2">
                <Select
                  value={filters[matchKey]}
                  onValueChange={(value) =>
                    onChange({
                      ...filters,
                      [matchKey]: value as Filters[typeof matchKey],
                    })
                  }
                >
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">
                      {t('Expenses.filters.matchModeAny')}
                    </SelectItem>
                    <SelectItem value="all">
                      {t('Expenses.filters.matchModeAll')}
                    </SelectItem>
                    <SelectItem value="exact">
                      {t('Expenses.filters.matchModeExact')}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <div className="flex max-h-32 flex-col gap-2 overflow-auto">
                  {options.people.map((person) => {
                    const ref = personValue(person)
                    return (
                      <label
                        key={`${person.kind}:${person.id}`}
                        className="flex items-center gap-2"
                      >
                        <Checkbox
                          checked={selected.some((entry) =>
                            samePerson(entry, ref),
                          )}
                          onCheckedChange={() => togglePerson(key, ref)}
                        />
                        <span>
                          {person.name}
                          {person.groupName && (
                            <span className="text-muted-foreground">
                              {' '}
                              · {person.groupName}
                            </span>
                          )}
                        </span>
                      </label>
                    )
                  })}
                </div>
              </div>
            </FilterChoice>
          )
        })}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <FilterChoice label={t('Expenses.filters.dateFrom')}>
          <DateInput
            pickerTitle={t('Expenses.filters.dateFrom')}
            value={filters.dateFrom}
            onValueChange={(dateFrom) => onChange({ ...filters, dateFrom })}
          />
        </FilterChoice>
        <FilterChoice label={t('Expenses.filters.dateTo')}>
          <DateInput
            pickerTitle={t('Expenses.filters.dateTo')}
            value={filters.dateTo}
            onValueChange={(dateTo) => onChange({ ...filters, dateTo })}
          />
        </FilterChoice>
        <FilterChoice label={t('Expenses.globalCurrency')}>
          <Select
            value={filters.currencies[0] ?? 'all'}
            onValueChange={(value) => {
              if (value == null) return
              onChange({
                ...filters,
                currencies: value === 'all' ? [] : [value],
                minAmount: value === 'all' ? '' : filters.minAmount,
                maxAmount: value === 'all' ? '' : filters.maxAmount,
                sortBy:
                  value === 'all' && filters.sortBy === 'amount'
                    ? 'expenseDate'
                    : filters.sortBy,
              })
            }}
          >
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                {t('Expenses.globalAllCurrencies')}
              </SelectItem>
              {options.currencies.map((currency) => (
                <SelectItem key={currency.key} value={currency.key}>
                  {currency.currencyCode ?? currency.currency}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FilterChoice>
        <FilterChoice label={t('Expenses.filters.amountRange')}>
          <div className="grid grid-cols-2 gap-2">
            <Input
              type="text"
              inputMode="decimal"
              disabled={!selectedCurrency}
              placeholder={t('Expenses.filters.minAmount')}
              value={localizeCurrencyInput(filters.minAmount, locale)}
              onChange={(e) =>
                onChange({
                  ...filters,
                  minAmount: enforceCurrencyPattern(
                    e.target.value,
                    selectedCurrencyDetails?.decimal_digits,
                    locale,
                  ),
                })
              }
            />
            <Input
              type="text"
              inputMode="decimal"
              disabled={!selectedCurrency}
              placeholder={t('Expenses.filters.maxAmount')}
              value={localizeCurrencyInput(filters.maxAmount, locale)}
              onChange={(e) =>
                onChange({
                  ...filters,
                  maxAmount: enforceCurrencyPattern(
                    e.target.value,
                    selectedCurrencyDetails?.decimal_digits,
                    locale,
                  ),
                })
              }
            />
          </div>
          {!selectedCurrency && (
            <p className="text-xs text-muted-foreground">
              {t('Expenses.globalCurrencyRequired')}
            </p>
          )}
        </FilterChoice>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2">
          <Checkbox
            checked={filters.showSettlements}
            onCheckedChange={(checked) =>
              onChange({ ...filters, showSettlements: checked === true })
            }
          />
          {t('Expenses.showSettlements')}
        </label>
        <div className="ms-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {t('Expenses.filters.sort.title')}
          </span>
          <Select
            value={`${filters.sortBy}-${filters.sortDir}`}
            onValueChange={(value) => {
              if (value == null) return
              const [sortBy, sortDir] = value.split('-') as [
                Filters['sortBy'],
                Filters['sortDir'],
              ]
              onChange({ ...filters, sortBy, sortDir })
            }}
          >
            <SelectTrigger className="h-9 w-44 text-xs">
              <ArrowDownWideNarrow className="me-1 h-3.5 w-3.5" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="expenseDate-desc">
                {t('Expenses.filters.sort.options.expenseDate.desc')}
              </SelectItem>
              <SelectItem value="expenseDate-asc">
                {t('Expenses.filters.sort.options.expenseDate.asc')}
              </SelectItem>
              <SelectItem value="createdAt-desc">
                {t('Expenses.filters.sort.options.createdAt.desc')}
              </SelectItem>
              <SelectItem value="createdAt-asc">
                {t('Expenses.filters.sort.options.createdAt.asc')}
              </SelectItem>
              <SelectItem value="amount-desc" disabled={!selectedCurrency}>
                {t('Expenses.filters.sort.options.amount.desc')}
              </SelectItem>
              <SelectItem value="amount-asc" disabled={!selectedCurrency}>
                {t('Expenses.filters.sort.options.amount.asc')}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  )
}

function FilterChoice({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span className="text-xs font-semibold text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  )
}

function GlobalExpenseItem({
  expense,
  expensesSearch,
}: {
  expense: GlobalExpense
  expensesSearch: LinkProps['search']
}) {
  return (
    <ExpenseCard
      expense={expense}
      currency={getCurrencyFromGroup(expense.group)}
      groupId={expense.group.id}
      participantCount={expense.group.participantCount}
      groupLabel={expense.group.displayName}
      expensesSearch={expensesSearch}
    />
  )
}

function GlobalExpensePreview({
  groupId,
  expenseId,
  returnTo,
  onClose,
}: {
  groupId: string
  expenseId: string
  returnTo: string
  onClose: () => void
}) {
  const groupQuery = trpc.groups.get.useQuery({ groupId }, { retry: false })
  const data = groupQuery.data
  const context = data?.group
    ? {
        isLoading: false as const,
        groupId,
        group: data.group,
        displayName: data.displayName ?? data.group.name,
        currentLedgerParticipantId: data.currentLedgerParticipantId ?? null,
        currentMember: data.currentMember,
        currentInvitation: data.currentInvitation ?? null,
        linkInviteState: data.linkInviteState ?? null,
      }
    : {
        isLoading: true as const,
        groupId,
        group: undefined,
        displayName: undefined,
        currentLedgerParticipantId: undefined,
        currentMember: undefined,
        currentInvitation: undefined,
        linkInviteState: undefined,
      }

  return (
    <CurrentGroupProvider {...context}>
      <ExpensePreviewModal
        groupId={groupId}
        expenseId={expenseId}
        returnTo={returnTo}
        onClose={onClose}
      />
    </CurrentGroupProvider>
  )
}

function GlobalExpensesContent() {
  const { t } = useTranslation()
  const locale = useLocale()
  const navigate = useNavigate({ from: '/expenses' })
  const search = routeApi.useSearch()
  const selectedExpenseId = search.expenseId
  const selectedExpenseGroupId = search.expenseGroupId
  const optionsQuery = trpc.expenses.filterOptions.useQuery()
  const filters = useMemo(
    () => readFilters(search as Record<string, unknown>),
    [search],
  )
  const [debouncedSearch] = useDebounce(filters.q, 300)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [draftFilters, setDraftFilters] = useState(filters)
  const { ref: loadingRef, inView } = useInView()
  const accountPreferences = useSyncedAccountPreferences()
  const accountTimeZone =
    accountPreferences?.timeZone ?? detectDeviceTimeZone() ?? 'UTC'
  const options = optionsQuery.data

  useEffect(() => {
    if (filtersOpen) {
      // oxlint-disable-next-line react/react-compiler -- seed the draft when the panel opens.
      setDraftFilters(filters)
    }
  }, [filters, filtersOpen])

  const commit = (next: Filters) => {
    void navigate({
      to: '/expenses',
      search: filtersToSearch(next) as never,
      replace: true,
    })
  }

  const closeExpense = () => {
    void navigate({
      to: '/expenses',
      search: filtersToSearch(filters) as never,
      replace: true,
    })
  }

  const input = useMemo(() => {
    const currency = filters.currencies[0]
    return {
      limit: 20,
      query: debouncedSearch || undefined,
      locale,
      groupIds: filters.groups.length ? filters.groups : undefined,
      categories: filters.categories.length ? filters.categories : undefined,
      paidBy: filters.paidBy.length ? filters.paidBy : undefined,
      paidByMatch: filters.paidByMatch,
      paidFor: filters.paidFor.length ? filters.paidFor : undefined,
      paidForMatch: filters.paidForMatch,
      hideSettlements: !filters.showSettlements,
      dateFrom: filters.dateFrom
        ? new Date(`${filters.dateFrom}T00:00:00.000Z`)
        : undefined,
      dateTo: filters.dateTo
        ? new Date(`${filters.dateTo}T00:00:00.000Z`)
        : undefined,
      minAmount: amountToMinor(filters.minAmount, currency),
      maxAmount: amountToMinor(filters.maxAmount, currency),
      currencies: filters.currencies.length ? filters.currencies : undefined,
      sortBy: filters.sortBy,
      sortDir: filters.sortDir,
    }
  }, [debouncedSearch, filters, locale])
  const expensesQuery = trpc.expenses.list.useInfiniteQuery(input, {
    enabled: options !== undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  })
  const expenses =
    expensesQuery.data?.pages.flatMap((page) => page.expenses) ?? []
  const hasMore = expensesQuery.data?.pages.at(-1)?.hasMore ?? false

  useEffect(() => {
    if (inView && hasMore && !expensesQuery.isFetching)
      void expensesQuery.fetchNextPage()
  }, [expensesQuery, hasMore, inView])

  const returnTo = buildGlobalExpensesReturnTo(filters)
  const activeFilterCount = [
    filters.groups.length,
    filters.categories.length,
    filters.paidBy.length,
    filters.paidFor.length,
    filters.dateFrom || filters.dateTo ? 1 : 0,
    filters.minAmount || filters.maxAmount ? 1 : 0,
    filters.currencies.length,
    filters.showSettlements ? 0 : 1,
  ].reduce((sum, count) => sum + (typeof count === 'number' ? count : 0), 0)

  return (
    <>
      <main className="mx-auto flex w-full max-w-(--breakpoint-md) min-w-0 flex-1 flex-col gap-4 overflow-x-hidden px-4 py-4 sm:gap-6 sm:py-6">
        <Card className="-mx-4 mb-4 rounded-none border-x-0 sm:mx-0 sm:rounded-lg sm:border-x">
          <div className="p-4 sm:p-6">
            <CardTitle>{t('Expenses.globalTitle')}</CardTitle>
            <CardDescription>{t('Expenses.globalDescription')}</CardDescription>
          </div>
          <CardContent className="relative flex flex-col gap-4 p-0 pt-2 pb-4 sm:pb-6">
            <div className="mx-4 flex items-center gap-2 sm:mx-6">
              <div className="relative flex-1">
                <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="h-9 border-none bg-muted ps-10 text-sm text-muted-foreground"
                  value={filters.q}
                  onChange={(e) => commit({ ...filters, q: e.target.value })}
                  placeholder={t('Expenses.searchPlaceholder')}
                />
                {filters.q && (
                  <button
                    type="button"
                    onClick={() => commit({ ...filters, q: '' })}
                    className="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                    aria-label={t('Expenses.clearSearch')}
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <Button
                type="button"
                variant={filtersOpen ? 'default' : 'outline'}
                size="sm"
                className="h-9 px-3 text-xs"
                onClick={() => setFiltersOpen((open) => !open)}
                aria-expanded={filtersOpen}
              >
                <Filter className="me-1 h-3.5 w-3.5" />
                {t('Expenses.filters.button')}
                {activeFilterCount > 0 && (
                  <Badge variant="secondary" className="ms-1">
                    {activeFilterCount}
                  </Badge>
                )}
              </Button>
            </div>
            {filtersOpen && options && (
              <div className="mx-4 rounded-md border-y bg-muted/30 p-3 sm:mx-6 sm:border sm:p-4">
                <GlobalExpenseFilters
                  filters={draftFilters}
                  onChange={setDraftFilters}
                  options={options}
                />
                <div className="mt-4 flex items-center justify-end gap-2 border-t pt-3">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setDraftFilters(readFilters({}))}
                  >
                    {t('Expenses.filters.noMatchClear')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setDraftFilters(filters)
                      setFiltersOpen(false)
                    }}
                  >
                    {t('Expenses.filters.cancel')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      commit(draftFilters)
                      setFiltersOpen(false)
                    }}
                  >
                    {t('Expenses.filters.apply')}
                  </Button>
                </div>
              </div>
            )}
            {!filtersOpen && activeFilterCount > 0 && (
              <div className="mx-4 flex flex-wrap gap-1 sm:mx-6">
                <Badge variant="secondary">
                  {t('Expenses.globalFiltersActive', {
                    count: activeFilterCount,
                  })}
                </Badge>
                <button
                  type="button"
                  className="text-xs text-primary underline"
                  onClick={() => commit(readFilters({}))}
                >
                  {t('Expenses.filters.noMatchClear')}
                </button>
              </div>
            )}
            <section aria-label={t('Expenses.globalTitle')}>
              {optionsQuery.error || expensesQuery.error ? (
                <div className="mx-4 rounded-lg border bg-card px-4 py-10 text-center text-sm text-destructive sm:mx-6">
                  {(optionsQuery.error ?? expensesQuery.error)?.message}
                </div>
              ) : expensesQuery.isLoading ||
                optionsQuery.isLoading ||
                !options ? (
                <ExpensesLoading />
              ) : expenses.length === 0 ? (
                <div className="px-6 py-6 text-sm text-muted-foreground">
                  {t('Expenses.globalEmpty')}
                </div>
              ) : (
                <ExpenseTimeline
                  expenses={expenses}
                  sortBy={filters.sortBy}
                  timeZone={accountTimeZone}
                  hasMore={hasMore}
                  loadingRef={loadingRef}
                  renderExpense={(expense) => (
                    <GlobalExpenseItem
                      key={`${expense.group.id}:${expense.id}`}
                      expense={expense}
                      expensesSearch={
                        {
                          ...filtersToSearch(filters),
                          expenseId: expense.id,
                          expenseGroupId: expense.group.id,
                        } as LinkProps['search']
                      }
                    />
                  )}
                />
              )}
            </section>
          </CardContent>
        </Card>
      </main>
      {selectedExpenseId && selectedExpenseGroupId && (
        <GlobalExpensePreview
          groupId={selectedExpenseGroupId}
          expenseId={selectedExpenseId}
          returnTo={returnTo}
          onClose={closeExpense}
        />
      )}
    </>
  )
}

export default function GlobalExpensesPage() {
  return (
    <RequireAuth>
      <GlobalExpensesContent />
    </RequireAuth>
  )
}

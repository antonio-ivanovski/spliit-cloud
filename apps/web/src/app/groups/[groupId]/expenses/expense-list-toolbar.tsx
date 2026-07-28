import {
  ArrowDownWideNarrow,
  ArrowUpDown,
  ArrowUpNarrowWide,
  CalendarArrowDown,
  CalendarArrowUp,
  ClockArrowDown,
  ClockArrowUp,
  Filter,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useCurrentGroup } from '@/app/groups/[groupId]/current-group-context'
import { categoryLabel } from '@/app/groups/[groupId]/stats/category-utils'
import { useLinkInviteToken } from '@/app/groups/[groupId]/use-link-invite-token'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible'
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from '@/components/ui/responsive-dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import { useMediaQuery } from '@/lib/hooks'
import { cn } from '@/lib/utils'
import { trpc } from '@/trpc/client'
import type { CategoryId } from '@spliit/domain'

import { ExpenseFiltersContent } from './expense-filters-content'
import { useExpenseFiltersContext } from './expense-filters-context'
import { DEFAULT_FILTERS, type ExpenseFilters } from './use-expense-filters'

const SORT_OPTIONS = [
  {
    value: 'expenseDate-desc',
    sort: { sortBy: 'expenseDate', sortDir: 'desc' },
    Icon: CalendarArrowDown,
  },
  {
    value: 'expenseDate-asc',
    sort: { sortBy: 'expenseDate', sortDir: 'asc' },
    Icon: CalendarArrowUp,
  },
  {
    value: 'amount-desc',
    sort: { sortBy: 'amount', sortDir: 'desc' },
    Icon: ArrowDownWideNarrow,
  },
  {
    value: 'amount-asc',
    sort: { sortBy: 'amount', sortDir: 'asc' },
    Icon: ArrowUpNarrowWide,
  },
  {
    value: 'createdAt-desc',
    sort: { sortBy: 'createdAt', sortDir: 'desc' },
    Icon: ClockArrowDown,
  },
  {
    value: 'createdAt-asc',
    sort: { sortBy: 'createdAt', sortDir: 'asc' },
    Icon: ClockArrowUp,
  },
] as const

function SortControl() {
  const isDesktop = useMediaQuery('(min-width: 640px)')
  const { sort, setSort } = useExpenseFiltersContext()
  const { t: tFilters } = useTranslation(undefined, {
    keyPrefix: 'Expenses.filters',
  })
  const [mobileOpen, setMobileOpen] = useState(false)

  if (!isDesktop) {
    return (
      <ResponsiveDialog open={mobileOpen} onOpenChange={setMobileOpen}>
        <ResponsiveDialogTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 w-9 p-0"
            aria-label={tFilters('sort.title')}
          >
            <ArrowUpDown className="h-4 w-4" />
          </Button>
        </ResponsiveDialogTrigger>
        <ResponsiveDialogContent className="sm:max-w-md">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>
              {tFilters('sort.title')}
            </ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <ResponsiveDialogBody>
            <div className="flex flex-col">
              {SORT_OPTIONS.map((option) => {
                const isActive =
                  option.sort.sortBy === sort.sortBy &&
                  option.sort.sortDir === sort.sortDir
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      setSort(option.sort)
                      setMobileOpen(false)
                    }}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 rounded-md px-3 py-2.5 text-left text-sm hover:bg-muted/40',
                      isActive && 'bg-muted/60 font-semibold',
                    )}
                  >
                    <option.Icon className="h-4 w-4 text-muted-foreground" />
                    <span className="flex-1">
                      {tFilters(
                        `sort.options.${option.sort.sortBy}.${option.sort.sortDir}`,
                      )}
                    </span>
                  </button>
                )
              })}
            </div>
          </ResponsiveDialogBody>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    )
  }

  return (
    <Select
      value={`${sort.sortBy}-${sort.sortDir}`}
      onValueChange={(value) => {
        const option = SORT_OPTIONS.find((o) => o.value === value)
        if (option) setSort(option.sort)
      }}
    >
      <SelectTrigger
        className="h-9 w-9 justify-center p-0 [&>svg:last-child]:hidden"
        aria-label={tFilters('sort.title')}
      >
        <ArrowUpDown className="h-4 w-4" />
      </SelectTrigger>
      <SelectContent>
        {SORT_OPTIONS.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            className="text-sm"
          >
            <span className="flex items-center gap-2">
              <option.Icon className="h-3 w-3" />
              {tFilters(
                `sort.options.${option.sort.sortBy}.${option.sort.sortDir}`,
              )}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function ExpenseListToolbar() {
  const { activeCount, filtersOpen, setFiltersOpen } =
    useExpenseFiltersContext()
  const { t: tFilters } = useTranslation(undefined, {
    keyPrefix: 'Expenses.filters',
  })

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant={filtersOpen ? 'default' : 'outline'}
        size="sm"
        className="h-9 px-3 text-xs"
        aria-expanded={filtersOpen}
        aria-controls="expense-filters-panel"
        onClick={() => setFiltersOpen((open) => !open)}
      >
        <Filter className="mr-1 h-3.5 w-3.5" />
        {tFilters('button')}
        {activeCount > 0 ? (
          <Badge
            variant="secondary"
            className={cn(
              'ml-1.5 h-5 min-w-5 rounded-full px-1.5 text-xs font-semibold',
              filtersOpen && 'bg-primary-foreground text-primary',
            )}
          >
            {activeCount}
          </Badge>
        ) : null}
      </Button>

      <div className="flex-1" />

      <SortControl />
    </div>
  )
}

export function ExpenseListFilterChips({ className }: { className?: string }) {
  const { group } = useCurrentGroup()
  const { filters, setFilters, filtersOpen } = useExpenseFiltersContext()
  const { t: tFilters } = useTranslation(undefined, {
    keyPrefix: 'Expenses.filters',
  })
  const { t: tCategories } = useTranslation(undefined, {
    keyPrefix: 'Categories',
  })

  if (filtersOpen || !group) return null

  const participantMap = new Map(group.participants.map((p) => [p.id, p.name]))

  type Chip = { key: string; label: string; onRemove: () => void }
  const chips: Chip[] = []

  if (!filters.showSettlements) {
    chips.push({
      key: 'showSettlements',
      label: tFilters('settlementsHidden'),
      onRemove: () => setFilters({ ...filters, showSettlements: true }),
    })
  }

  for (const catId of filters.categories) {
    chips.push({
      key: `cat-${catId}`,
      label: categoryLabel(tCategories, catId as CategoryId),
      onRemove: () =>
        setFilters({
          ...filters,
          categories: filters.categories.filter((c) => c !== catId),
        }),
    })
  }

  for (const pId of filters.paidBy) {
    chips.push({
      key: `pb-${pId}`,
      label: participantMap.get(pId) ?? pId,
      onRemove: () =>
        setFilters({
          ...filters,
          paidBy: filters.paidBy.filter((p) => p !== pId),
        }),
    })
  }

  if (filters.paidBy.length > 0 && filters.paidByMatch !== 'any') {
    chips.push({
      key: 'pbMatch',
      label:
        filters.paidByMatch === 'all'
          ? tFilters('matchModeAll')
          : tFilters('matchModeExact'),
      onRemove: () => setFilters({ ...filters, paidByMatch: 'any' }),
    })
  }

  for (const pId of filters.paidFor) {
    chips.push({
      key: `pf-${pId}`,
      label: participantMap.get(pId) ?? pId,
      onRemove: () =>
        setFilters({
          ...filters,
          paidFor: filters.paidFor.filter((p) => p !== pId),
        }),
    })
  }

  if (filters.paidFor.length > 0 && filters.paidForMatch !== 'any') {
    chips.push({
      key: 'pfMatch',
      label:
        filters.paidForMatch === 'all'
          ? tFilters('matchModeAll')
          : tFilters('matchModeExact'),
      onRemove: () => setFilters({ ...filters, paidForMatch: 'any' }),
    })
  }

  if (filters.dateFrom || filters.dateTo) {
    const from = filters.dateFrom ?? '…'
    const to = filters.dateTo ?? '…'
    chips.push({
      key: 'dateRange',
      label: `${from} – ${to}`,
      onRemove: () =>
        setFilters({ ...filters, dateFrom: undefined, dateTo: undefined }),
    })
  }

  if (filters.minAmount || filters.maxAmount) {
    const min = filters.minAmount ?? '…'
    const max = filters.maxAmount ?? '…'
    chips.push({
      key: 'amountRange',
      label: `${min} – ${max}`,
      onRemove: () =>
        setFilters({
          ...filters,
          minAmount: undefined,
          maxAmount: undefined,
        }),
    })
  }

  for (const code of filters.currencies) {
    chips.push({
      key: `cur-${code}`,
      label: code,
      onRemove: () =>
        setFilters({
          ...filters,
          currencies: filters.currencies.filter((c) => c !== code),
        }),
    })
  }

  if (chips.length === 0) return null

  return (
    <div className={cn('flex flex-wrap gap-1.5', className)}>
      {chips.map((chip) => (
        <Badge
          key={chip.key}
          variant="secondary"
          className="gap-1 py-0 pr-1 text-xs"
        >
          <span className="max-w-40 truncate">{chip.label}</span>
          <button
            type="button"
            onClick={chip.onRemove}
            aria-label={tFilters('removeFilter')}
            className="ml-0.5 rounded-sm hover:bg-muted-foreground/20"
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}
    </div>
  )
}

export function ExpenseListFiltersPanel() {
  const { group, groupId } = useCurrentGroup()
  const linkInviteToken = useLinkInviteToken()
  const { filters, setFilters, filtersOpen, setFiltersOpen } =
    useExpenseFiltersContext()

  const currenciesQuery = trpc.groups.expenses.commonCurrencies.useQuery(
    { groupId, linkInviteToken },
    { enabled: !!group, staleTime: 60_000 },
  )

  const [draft, setDraft] = useState<ExpenseFilters>(filters)
  useEffect(() => {
    if (filtersOpen) {
      // oxlint-disable-next-line react/react-compiler -- draft filters mirror the context when the panel opens.
      setDraft(filters)
    }
  }, [filtersOpen, filters])

  if (!group) return null

  const apply = () => {
    setFilters(draft)
    setFiltersOpen(false)
  }
  const cancel = () => {
    setDraft(filters)
    setFiltersOpen(false)
  }
  const resetDraft = () => setDraft(DEFAULT_FILTERS)

  const content = (
    <ExpenseFiltersContent
      group={group}
      commonCurrencies={currenciesQuery.data}
      draft={draft}
      onDraftChange={setDraft}
      onApply={apply}
      onCancel={cancel}
      onResetDraft={resetDraft}
      showFooter
    />
  )

  return (
    <Collapsible
      open={filtersOpen}
      onOpenChange={setFiltersOpen}
      className="mx-4 sm:mx-6"
    >
      <CollapsibleContent
        id="expense-filters-panel"
        className="mt-1 mb-2 rounded-md border-y bg-muted/30 p-3 sm:border sm:p-4"
      >
        {content}
      </CollapsibleContent>
    </Collapsible>
  )
}

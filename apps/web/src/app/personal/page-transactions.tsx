import { Link } from '@tanstack/react-router'
import {
  ArrowDownWideNarrow,
  Download,
  Filter,
  ListChecks,
  Plus,
  Search,
  Sparkles,
  Upload,
  X,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useDebounce } from 'use-debounce'

import { CategorySelector } from '@/components/category-selector'
import { useDocumentTitle } from '@/components/document-title'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/components/ui/use-toast'
import { useLocale } from '@/i18n/react'
import { getCurrency } from '@/lib/currency'
import {
  enforceCurrencyPattern,
  localizeCurrencyInput,
  normalizeDigits,
} from '@/lib/currency-input'
import { cn, formatCurrency } from '@/lib/utils'
import { trpc } from '@/trpc/client'
import {
  DEFAULT_CATEGORIES,
  amountAsMinorUnits,
  toggleCategorySelection,
  type CategoryId,
} from '@spliit/domain'

import {
  useAutoCategorizePersonal,
  useExportPersonalTransactions,
  usePersonalProfile,
  usePersonalTransactions,
} from './api'
import { PersonalEntryDetail } from './entry-detail'
import { PersonalEntryRow } from './entry-row'
import { usePersonalTranslation } from './personal-i18n'
import { PersonalQuickAdd } from './quick-add'
import type {
  PersonalEntry,
  PersonalEntryKind,
  PersonalEntrySource,
} from './types'

export type PersonalTransactionsFilters = {
  q: string
  month: string
  categoryIds: CategoryId[]
  source: 'ALL' | PersonalEntrySource
  kind: 'ALL' | PersonalEntryKind
  minAmount: string
  maxAmount: string
}

export const emptyTransactionsFilters: PersonalTransactionsFilters = {
  q: '',
  month: '',
  categoryIds: [],
  source: 'ALL',
  kind: 'ALL',
  minAmount: '',
  maxAmount: '',
}

function dayLabel(dateIso: string, locale: string): string {
  const date = new Date(`${dateIso}T12:00:00.000Z`)
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

type DayGroup = {
  date: string
  entries: PersonalEntry[]
  spent: number
  income: number
}

function groupByDay(entries: PersonalEntry[]): DayGroup[] {
  const map = new Map<string, PersonalEntry[]>()
  for (const entry of entries) {
    const list = map.get(entry.date) ?? []
    list.push(entry)
    map.set(entry.date, list)
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([date, dayEntries]) => {
      let spent = 0
      let income = 0
      for (const entry of dayEntries) {
        if (entry.kind === 'INCOME') income += Math.abs(entry.amount)
        else spent += Math.abs(entry.amount)
      }
      return { date, entries: dayEntries, spent, income }
    })
}

/**
 * Presentational transactions list: search + filters, day groups with daily
 * subtotals, shared badges, and the row detail dialog. The page wrapper below
 * wires the query; tests render this view with fixtures.
 */
export function PersonalTransactionsView({
  entries,
  totals,
  currencyCode,
  filters,
  onFiltersChange,
  onAdd,
  onAutoCategorize,
  autoCategorizing,
  onExport,
  exporting,
}: {
  entries: PersonalEntry[]
  totals: { spent: number; income: number; count: number } | undefined
  currencyCode: string
  filters: PersonalTransactionsFilters
  onFiltersChange: (filters: PersonalTransactionsFilters) => void
  onAdd: () => void
  onAutoCategorize: () => void
  autoCategorizing: boolean
  onExport: () => void
  exporting: boolean
}) {
  const { t } = usePersonalTranslation()
  const locale = useLocale()
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [selected, setSelected] = useState<PersonalEntry | null>(null)

  const currency = getCurrency(currencyCode)
  const { data: features } = trpc.features.get.useQuery()
  const groups = useMemo(() => groupByDay(entries), [entries])
  const activeFilterCount =
    (filters.month ? 1 : 0) +
    filters.categoryIds.length +
    (filters.source !== 'ALL' ? 1 : 0) +
    (filters.kind !== 'ALL' ? 1 : 0) +
    (filters.minAmount || filters.maxAmount ? 1 : 0)

  const formatMinor = (amount: number) =>
    currency ? formatCurrency(currency, amount, locale) : String(amount)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search
            className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            className="h-11 ps-10 sm:h-9"
            value={filters.q}
            onChange={(event) =>
              onFiltersChange({ ...filters, q: event.target.value })
            }
            placeholder={t('transactions.searchPlaceholder')}
            aria-label={t('transactions.searchPlaceholder')}
          />
          {filters.q && (
            <button
              type="button"
              onClick={() => onFiltersChange({ ...filters, q: '' })}
              className="absolute end-0 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center text-muted-foreground sm:size-9"
              aria-label={t('transactions.clearSearch')}
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          )}
        </div>
        <Button
          type="button"
          variant={filtersOpen ? 'default' : 'outline'}
          size="sm"
          className="h-11 px-3 text-xs sm:h-9"
          onClick={() => setFiltersOpen((open) => !open)}
          aria-expanded={filtersOpen}
        >
          <Filter className="me-1.5 size-3.5" aria-hidden="true" />
          {t('transactions.filtersButton')}
          {activeFilterCount > 0 && (
            <span className="ms-1.5 rounded-full bg-primary-foreground/20 px-1.5 text-[11px] tabular-nums">
              {activeFilterCount}
            </span>
          )}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-11 px-3 text-xs sm:h-9"
          disabled={autoCategorizing}
          onClick={onAutoCategorize}
        >
          <Sparkles className="me-1.5 size-3.5" aria-hidden="true" />
          {t('transactions.autoCategorize')}
        </Button>
        {features?.enableBulkCategorize && (
          <Button
            type="button"
            variant="default"
            size="sm"
            className="h-11 px-3 text-xs sm:h-9"
            nativeButton={false}
            render={<Link to="/personal/transactions/categorize" />}
          >
            <ListChecks className="me-1.5 size-3.5" aria-hidden="true" />
            {t('categorization.reviewAndCategorize')}
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-11 px-3 text-xs sm:h-9"
          nativeButton={false}
          render={<Link to="/personal/transactions/import" />}
        >
          <Upload className="me-1.5 size-3.5" aria-hidden="true" />
          {t('import.importCsv')}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-11 px-3 text-xs sm:h-9"
          disabled={exporting}
          onClick={onExport}
        >
          <Download className="me-1.5 size-3.5" aria-hidden="true" />
          {t('transactions.exportCsv')}
        </Button>
        <Button
          type="button"
          size="sm"
          className="hidden h-9 sm:inline-flex"
          onClick={onAdd}
        >
          <Plus className="me-1.5 size-4" aria-hidden="true" />
          {t('overview.addExpense')}
        </Button>
      </div>

      {filtersOpen && (
        <Card>
          <CardContent spacing="standalone" className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="personal-filter-month">
                  {t('transactions.monthLabel')}
                </Label>
                <Input
                  id="personal-filter-month"
                  type="month"
                  value={filters.month}
                  onChange={(event) =>
                    onFiltersChange({ ...filters, month: event.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="personal-filter-source">
                  {t('transactions.sourceLabel')}
                </Label>
                <Select
                  value={filters.source}
                  items={[
                    { value: 'ALL', label: t('transactions.sourceAll') },
                    {
                      value: 'PERSONAL',
                      label: t('transactions.sourcePersonal'),
                    },
                    { value: 'GROUP', label: t('transactions.sourceGroup') },
                  ]}
                  onValueChange={(value) => {
                    if (!value) return
                    onFiltersChange({
                      ...filters,
                      source: value as PersonalTransactionsFilters['source'],
                    })
                  }}
                >
                  <SelectTrigger id="personal-filter-source" className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">
                      {t('transactions.sourceAll')}
                    </SelectItem>
                    <SelectItem value="PERSONAL">
                      {t('transactions.sourcePersonal')}
                    </SelectItem>
                    <SelectItem value="GROUP">
                      {t('transactions.sourceGroup')}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <span className="text-xs font-semibold text-muted-foreground">
                  {t('transactions.kindLabel')}
                </span>
                <div
                  // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- segmented filter is labeled by the group; fieldset would break the segmented styling
                  role="group"
                  aria-label={t('transactions.kindLabel')}
                  className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1"
                >
                  {(
                    [
                      { value: 'ALL', label: t('transactions.kindAll') },
                      { value: 'EXPENSE', label: t('quickAdd.expense') },
                      { value: 'INCOME', label: t('quickAdd.income') },
                    ] as const
                  ).map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={filters.kind === option.value}
                      onClick={() =>
                        onFiltersChange({ ...filters, kind: option.value })
                      }
                      className={cn(
                        'min-h-9 rounded-md px-2 text-xs font-medium outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                        filters.kind === option.value
                          ? 'bg-background text-foreground shadow-xs'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="personal-filter-min">
                  {t('transactions.amountLabel')}
                </Label>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    id="personal-filter-min"
                    type="text"
                    inputMode="decimal"
                    placeholder={t('transactions.minAmount')}
                    value={localizeCurrencyInput(filters.minAmount, locale)}
                    onChange={(event) =>
                      onFiltersChange({
                        ...filters,
                        minAmount: enforceCurrencyPattern(
                          event.target.value,
                          currency?.decimal_digits,
                          locale,
                        ),
                      })
                    }
                  />
                  <Input
                    type="text"
                    inputMode="decimal"
                    placeholder={t('transactions.maxAmount')}
                    aria-label={t('transactions.maxAmount')}
                    value={localizeCurrencyInput(filters.maxAmount, locale)}
                    onChange={(event) =>
                      onFiltersChange({
                        ...filters,
                        maxAmount: enforceCurrencyPattern(
                          event.target.value,
                          currency?.decimal_digits,
                          locale,
                        ),
                      })
                    }
                  />
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <span
                id="personal-filter-categories-label"
                className="text-xs font-semibold text-muted-foreground"
              >
                {t('transactions.categoriesLabel')}
              </span>
              <CategorySelector
                categories={DEFAULT_CATEGORIES}
                defaultValue="general"
                isLoading={false}
                mode="multi"
                onValueChange={() => undefined}
                selectedValues={filters.categoryIds}
                onValueToggle={(id) =>
                  onFiltersChange({
                    ...filters,
                    categoryIds: toggleCategorySelection(
                      filters.categoryIds,
                      id,
                    ),
                  })
                }
                multiPlaceholder={t('transactions.categoriesPlaceholder')}
                mobileTitle={t('transactions.categoriesLabel')}
                ariaLabel={t('transactions.categoriesLabel')}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={filters.source === 'GROUP'}
                onCheckedChange={(checked) =>
                  onFiltersChange({
                    ...filters,
                    source: checked === true ? 'GROUP' : 'ALL',
                  })
                }
              />
              {t('transactions.sharedOnly')}
            </label>
            <div className="flex items-center justify-end gap-2 border-t pt-3">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onFiltersChange(emptyTransactionsFilters)}
              >
                {t('transactions.clearFilters')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {totals && (
        <p
          className="flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums"
          aria-live="polite"
        >
          <ArrowDownWideNarrow className="size-3.5" aria-hidden="true" />
          {t('transactions.resultSummary', {
            count: totals.count,
            spent: formatMinor(totals.spent),
            income: formatMinor(totals.income),
          })}
        </p>
      )}

      {groups.length === 0 ? (
        <Card className="border-dashed">
          <CardContent
            spacing="standalone"
            className="flex flex-col items-center gap-2 py-10 text-center"
          >
            <p className="font-medium">{t('transactions.emptyTitle')}</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              {activeFilterCount > 0
                ? t('transactions.emptyFiltered')
                : t('transactions.emptyDescription')}
            </p>
            {activeFilterCount > 0 ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-1"
                onClick={() => onFiltersChange(emptyTransactionsFilters)}
              >
                {t('transactions.clearFilters')}
              </Button>
            ) : (
              <Button type="button" size="sm" className="mt-1" onClick={onAdd}>
                <Plus className="me-1.5 size-4" aria-hidden="true" />
                {t('overview.addExpense')}
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((group) => (
            <section key={group.date} aria-label={dayLabel(group.date, locale)}>
              <div className="flex items-baseline justify-between gap-3 px-1 pb-1">
                <h2 className="text-sm font-semibold">
                  {dayLabel(group.date, locale)}
                </h2>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {group.spent > 0 && <span>−{formatMinor(group.spent)}</span>}
                  {group.spent > 0 && group.income > 0 && ' · '}
                  {group.income > 0 && (
                    <span className="text-green-600 dark:text-green-400">
                      +{formatMinor(group.income)}
                    </span>
                  )}
                </p>
              </div>
              <Card>
                <CardContent className="px-2 py-1 sm:px-3">
                  <ul className="divide-y divide-border/60">
                    {group.entries.map((entry) => (
                      <PersonalEntryRow
                        key={entry.id}
                        entry={entry}
                        currencyCode={currencyCode}
                        onSelect={setSelected}
                      />
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </section>
          ))}
        </div>
      )}

      <PersonalEntryDetail
        entry={selected}
        currencyCode={currencyCode}
        onOpenChange={(open) => {
          if (!open) setSelected(null)
        }}
      />

      <Button
        type="button"
        size="icon"
        onClick={onAdd}
        aria-label={t('overview.addExpense')}
        className="fixed end-4 bottom-[calc(var(--mobile-nav-bar-height,4rem)+1.25rem)] z-40 size-14 rounded-full shadow-lg md:end-8 md:bottom-8"
      >
        <Plus className="size-6" aria-hidden="true" />
      </Button>
    </div>
  )
}

export function PersonalTransactionsPage() {
  const { t } = usePersonalTranslation()
  useDocumentTitle(t('transactions.documentTitle'))
  const profileQuery = usePersonalProfile()
  const locale = useLocale()
  const { toast } = useToast()
  const autoCategorize = useAutoCategorizePersonal()
  const exportTransactions = useExportPersonalTransactions()
  const [filters, setFilters] = useState<PersonalTransactionsFilters>(
    emptyTransactionsFilters,
  )
  const [debouncedQ] = useDebounce(filters.q, 300)
  const [quickAddOpen, setQuickAddOpen] = useState(false)

  const currencyCode = profileQuery.data?.currencyCode ?? 'USD'
  const currency = getCurrency(currencyCode)

  const queryFilter = useMemo(() => {
    const numberParts = new Intl.NumberFormat(locale).formatToParts(12345.6)
    const decimal =
      numberParts.find((part) => part.type === 'decimal')?.value ?? '.'
    const group =
      numberParts.find((part) => part.type === 'group')?.value ?? ','
    const toMinor = (value: string): number | undefined => {
      const normalized = normalizeDigits(value, locale)
        .split(group)
        .join('')
        .replace(decimal, '.')
      const parsed = Number(normalized)
      if (!Number.isFinite(parsed) || parsed <= 0 || !currency) return undefined
      return amountAsMinorUnits(parsed, currency)
    }
    return {
      ...(filters.month ? { month: filters.month } : {}),
      ...(debouncedQ.trim() ? { q: debouncedQ.trim() } : {}),
      ...(filters.categoryIds.length > 0
        ? { categoryIds: [...filters.categoryIds] as string[] }
        : {}),
      source: filters.source,
      ...(filters.kind !== 'ALL' ? { kinds: [filters.kind] } : {}),
      ...(toMinor(filters.minAmount) != null
        ? { minAmount: toMinor(filters.minAmount) }
        : {}),
      ...(toMinor(filters.maxAmount) != null
        ? { maxAmount: toMinor(filters.maxAmount) }
        : {}),
      limit: 100,
    }
  }, [filters, debouncedQ, currency, locale])

  const transactionsQuery = usePersonalTransactions(queryFilter)

  async function handleExport() {
    try {
      const result = await exportTransactions.mutateAsync(queryFilter)
      const url = URL.createObjectURL(
        new Blob([result.csv], { type: 'text/csv;charset=utf-8' }),
      )
      const link = document.createElement('a')
      link.href = url
      link.download = result.filename
      link.click()
      URL.revokeObjectURL(url)
      if (result.truncated) {
        toast({ description: t('transactions.exportTruncated') })
      }
    } catch {
      toast({
        description: t('transactions.exportFailed'),
        variant: 'destructive',
      })
    }
  }

  async function handleAutoCategorize() {
    try {
      const result = await autoCategorize.mutateAsync({ limit: 25 })
      toast({
        description: t('transactions.autoCategorizeResult', {
          applied: result.applied,
          scanned: result.scanned,
        }),
      })
    } catch {
      toast({
        description: t('transactions.autoCategorizeFailed'),
        variant: 'destructive',
      })
    }
  }

  if (profileQuery.isPending || transactionsQuery.isPending) {
    return (
      <div
        className="flex flex-col gap-4"
        aria-busy="true"
        aria-label={t('loading')}
      >
        <div className="h-11 animate-pulse rounded-lg bg-muted" />
        <div className="h-48 animate-pulse rounded-xl bg-muted" />
        <div className="h-48 animate-pulse rounded-xl bg-muted" />
      </div>
    )
  }

  if (profileQuery.isError || transactionsQuery.isError) {
    const error = profileQuery.error ?? transactionsQuery.error
    return (
      <Card className="border-destructive/30">
        <CardContent
          spacing="standalone"
          className="flex min-h-56 flex-col items-center justify-center gap-3 text-center"
        >
          <p role="alert" className="text-sm text-muted-foreground">
            {error instanceof Error ? error.message : t('transactions.error')}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              void profileQuery.refetch()
              void transactionsQuery.refetch()
            }}
          >
            {t('retry')}
          </Button>
        </CardContent>
      </Card>
    )
  }

  const entries = transactionsQuery.data?.entries ?? []
  const totals = transactionsQuery.data?.totals

  return (
    <>
      <PersonalTransactionsView
        entries={entries}
        totals={totals}
        currencyCode={currencyCode}
        filters={filters}
        onFiltersChange={setFilters}
        onAdd={() => setQuickAddOpen(true)}
        onAutoCategorize={() => void handleAutoCategorize()}
        autoCategorizing={autoCategorize.isPending}
        onExport={() => void handleExport()}
        exporting={exportTransactions.isPending}
      />
      <PersonalQuickAdd
        open={quickAddOpen}
        onOpenChange={setQuickAddOpen}
        defaultKind="EXPENSE"
      />
    </>
  )
}

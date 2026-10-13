import {
  CalendarDays,
  CalendarRange,
  ChartNoAxesCombined,
  ChevronDown,
  Coins,
  ReceiptText,
  TrendingDown,
} from 'lucide-react'
import { lazy, Suspense, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useSyncedAccountPreferences } from '@/components/account-preferences-sync'
import { ApiErrorEmptyState } from '@/components/api-error-empty-state'
import { OfflineEmptyState } from '@/components/offline-empty-state'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { DateInput } from '@/components/ui/date-input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useLocale } from '@/i18n/react'
import { getCurrencyFromGroup } from '@/lib/currency'
import { useConnectivityStatus } from '@/lib/use-online-status'
import { cn, formatDateOnly } from '@/lib/utils'
import { trpc } from '@/trpc/client'
import type { AppRouterOutput } from '@spliit/api/router'

import { StatsSummaryCard } from './[groupId]/stats/summary-card'
import { HomeStatsBreakdown } from './home-stats-breakdown'

export type HomeStatsData = AppRouterOutput['overview']['stats']['get']
type Filters = HomeStatsData['filters']
const periods: Filters['period'][] = [
  'WEEK',
  'MONTH',
  'LAST_MONTH',
  'QUARTER',
  'YEAR',
  'ALL_TIME',
  'CUSTOM',
]
const HomeStatsChart = lazy(() =>
  import('./home-stats-chart').then((module) => ({
    default: module.HomeStatsChart,
  })),
)

export function HomeStats({ initial }: { initial: HomeStatsData }) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Homepage.Activity' })
  const { t: tStats } = useTranslation(undefined, {
    keyPrefix: 'Stats.Dashboard',
  })
  const locale = useLocale()
  const preferences = useSyncedAccountPreferences()
  const connectivity = useConnectivityStatus()
  const controlId = useId()
  const [filters, setFilters] = useState(initial.filters)
  const [currencyKey, setCurrencyKey] = useState<string>()
  const isDefault = JSON.stringify(filters) === JSON.stringify(initial.filters)
  // Initial statistics reuse overview data; changed filters must never display
  // another person's previous results as placeholder data.
  const query = trpc.overview.stats.get.useQuery(filters, {
    enabled: !isDefault,
  })
  const data = isDefault ? initial : query.data
  const currencies = data?.currencies ?? []
  const selected =
    currencies.find((currency) => currency.key === currencyKey) ??
    currencies.find(
      (currency) => currency.currencyCode === preferences?.defaultCurrencyCode,
    ) ??
    currencies[0]
  const currency = selected ? getCurrencyFromGroup(selected) : null
  const people = data?.people ?? initial.people
  const personValue =
    filters.person.kind === 'ACCOUNT'
      ? `account:${filters.person.accountId}`
      : filters.person.kind
  const updateScope = (changes: Partial<Filters>) =>
    setFilters((previous) => ({
      ...previous,
      ...changes,
      person: { kind: 'ME' },
    }))
  const eligibleGroups = initial.groups.filter(
    (group) =>
      filters.scope === 'ALL' ||
      group.groupType === (filters.scope === 'GROUPS' ? 'GROUP' : 'FRIEND'),
  )
  const selectedGroupIds =
    filters.groupIds ?? eligibleGroups.map((group) => group.groupId)
  const dateLabel = (value: string) =>
    formatDateOnly(new Date(`${value}T00:00:00Z`), locale, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  const range = data?.range
  const rangeLabel =
    range?.from && range.to
      ? t('range', { from: dateLabel(range.from), to: dateLabel(range.to) })
      : null
  const changePeriod = (period: Filters['period']) =>
    setFilters((previous) => ({
      ...previous,
      period,
      customRange:
        period === 'CUSTOM'
          ? (previous.customRange ?? {
              from: initial.range.from!,
              to: initial.range.to!,
            })
          : undefined,
    }))

  return (
    <section aria-label={t('title')} className="space-y-4">
      <Card className="border-primary/10 bg-linear-to-br from-primary/8 via-background to-background shadow-none">
        <CardContent spacing="standalone" className="space-y-4">
          <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-center">
            <div className="shrink-0">
              <h2 className="font-semibold tracking-tight">{t('title')}</h2>
              {rangeLabel && (
                <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                  <CalendarDays className="size-3.5 shrink-0" aria-hidden />
                  <span>{rangeLabel}</span>
                </p>
              )}
            </div>
            <fieldset
              aria-label={t('period')}
              className="min-w-0 rounded-lg border bg-muted/40 p-1"
            >
              <div className="flex flex-wrap gap-1">
                {periods.map((period) => (
                  <Button
                    key={period}
                    size="sm"
                    variant="ghost"
                    aria-pressed={filters.period === period}
                    className={cn(
                      'h-8 px-2.5 text-xs text-muted-foreground',
                      filters.period === period &&
                        'bg-background text-foreground shadow-xs hover:bg-background',
                    )}
                    onClick={() => changePeriod(period)}
                  >
                    {period === 'CUSTOM' && (
                      <CalendarRange className="size-3.5" aria-hidden />
                    )}
                    {t(`periods.${period}`)}
                  </Button>
                ))}
              </div>
              {filters.period === 'CUSTOM' && filters.customRange && (
                <div className="mt-1 grid gap-2 border-t px-1 pt-2 sm:grid-cols-2">
                  <label className="grid gap-1 text-[11px] font-medium text-muted-foreground">
                    {tStats('customRange.from')}
                    <DateInput
                      className="date-base h-8 bg-background text-xs"
                      pickerTitle={tStats('customRange.from')}
                      value={filters.customRange.from}
                      onValueChange={(from) =>
                        setFilters((previous) => ({
                          ...previous,
                          customRange: {
                            from,
                            to:
                              from > previous.customRange!.to
                                ? from
                                : previous.customRange!.to,
                          },
                        }))
                      }
                    />
                  </label>
                  <label className="grid gap-1 text-[11px] font-medium text-muted-foreground">
                    {tStats('customRange.to')}
                    <DateInput
                      className="date-base h-8 bg-background text-xs"
                      pickerTitle={tStats('customRange.to')}
                      value={filters.customRange.to}
                      onValueChange={(to) =>
                        setFilters((previous) => ({
                          ...previous,
                          customRange: {
                            from:
                              to < previous.customRange!.from
                                ? to
                                : previous.customRange!.from,
                            to,
                          },
                        }))
                      }
                    />
                  </label>
                </div>
              )}
            </fieldset>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label
                htmlFor={`${controlId}-person`}
                className="text-xs text-muted-foreground"
              >
                {t('person')}
              </Label>
              <Select
                value={personValue}
                onValueChange={(value) => {
                  if (value)
                    setFilters((previous) => ({
                      ...previous,
                      person: value.startsWith('account:')
                        ? { kind: 'ACCOUNT', accountId: value.slice(8) }
                        : { kind: value === 'SHARED' ? 'SHARED' : 'ME' },
                    }))
                }}
              >
                <SelectTrigger
                  id={`${controlId}-person`}
                  className="min-w-0 text-sm"
                >
                  <SelectValue>
                    {personValue === 'ME'
                      ? t('me')
                      : personValue === 'SHARED'
                        ? t('shared')
                        : people.find(
                            (person) =>
                              `account:${person.accountId}` === personValue,
                          )?.name}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ME">{t('me')}</SelectItem>
                  <SelectItem value="SHARED">{t('shared')}</SelectItem>
                  {people.map((person) => (
                    <SelectItem
                      key={person.accountId}
                      value={`account:${person.accountId}`}
                    >
                      {person.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label
                htmlFor={`${controlId}-scope`}
                className="text-xs text-muted-foreground"
              >
                {t('scope')}
              </Label>
              <Select
                value={filters.scope}
                onValueChange={(value) => {
                  if (value)
                    updateScope({
                      scope: value as Filters['scope'],
                      groupIds: undefined,
                    })
                }}
              >
                <SelectTrigger
                  id={`${controlId}-scope`}
                  className="min-w-0 text-sm"
                >
                  <SelectValue>
                    {t(
                      filters.scope === 'ALL'
                        ? 'all'
                        : filters.scope === 'GROUPS'
                          ? 'groups'
                          : 'friends',
                    )}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">{t('all')}</SelectItem>
                  <SelectItem value="GROUPS">{t('groups')}</SelectItem>
                  <SelectItem value="FRIENDS">{t('friends')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label
                htmlFor={`${controlId}-currency`}
                className="text-xs text-muted-foreground"
              >
                {t('currency')}
              </Label>
              <Select
                value={selected?.key ?? null}
                disabled={currencies.length === 0}
                onValueChange={(value) => {
                  if (value) setCurrencyKey(value)
                }}
              >
                <SelectTrigger
                  id={`${controlId}-currency`}
                  className="min-w-0 text-sm"
                >
                  <SelectValue>
                    {selected?.currencyCode ?? selected?.currency}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {currencies.map((item) => (
                    <SelectItem key={item.key} value={item.key}>
                      {item.currencyCode ?? item.currency}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Collapsible>
            <CollapsibleTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  className="group -ms-2 h-8 text-xs text-muted-foreground"
                />
              }
            >
              {t('more')}
              <ChevronDown
                className="size-3.5 transition-transform group-data-[panel-open]:rotate-180"
                aria-hidden
              />
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-4 pt-3">
              <div className="flex flex-wrap gap-x-6 gap-y-3">
                <Label className="flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox
                    checked={filters.includeArchived}
                    onCheckedChange={(checked) =>
                      updateScope({ includeArchived: checked })
                    }
                  />
                  {t('includeArchived')}
                </Label>
                <Label className="flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox
                    checked={filters.includeHidden}
                    onCheckedChange={(checked) =>
                      updateScope({ includeHidden: checked })
                    }
                  />
                  {t('includeHidden')}
                </Label>
              </div>
              <fieldset className="rounded-lg border bg-background/60 p-3">
                <legend className="px-1 text-xs font-medium text-muted-foreground">
                  {t('selectLedgers')}
                </legend>
                <div className="grid max-h-60 gap-1 overflow-y-auto sm:grid-cols-2">
                  {eligibleGroups.map((group) => (
                    <Label
                      key={group.groupId}
                      className="flex min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-muted/60"
                    >
                      <Checkbox
                        checked={selectedGroupIds.includes(group.groupId)}
                        onCheckedChange={(checked) =>
                          updateScope({
                            groupIds: checked
                              ? [...selectedGroupIds, group.groupId]
                              : selectedGroupIds.filter(
                                  (id) => id !== group.groupId,
                                ),
                          })
                        }
                      />
                      <span className="min-w-0 truncate">{group.name}</span>
                    </Label>
                  ))}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="mt-2 h-8 text-xs"
                  onClick={() => updateScope({ groupIds: undefined })}
                >
                  {t('all')}
                </Button>
              </fieldset>
              <p className="text-xs text-muted-foreground">
                {t('inclusionHint')}
              </p>
            </CollapsibleContent>
          </Collapsible>
          <div className="space-y-1 text-xs text-muted-foreground">
            <p>
              {filters.person.kind === 'ACCOUNT'
                ? t('personHint', {
                    name:
                      people.find(
                        (person) =>
                          person.accountId ===
                          (filters.person.kind === 'ACCOUNT'
                            ? filters.person.accountId
                            : ''),
                      )?.name ?? '',
                  })
                : filters.person.kind === 'SHARED'
                  ? t('shared')
                  : t('shareHint')}
            </p>
            <p>{t('dateHint')}</p>
          </div>
        </CardContent>
      </Card>
      {!isDefault && query.isFetching && (
        <output className="block text-sm text-muted-foreground">
          {t('updating')}
        </output>
      )}
      {data && connectivity !== 'online' && (
        <output className="block text-sm text-muted-foreground">
          {t('stale')}
        </output>
      )}
      {!data ? (
        connectivity === 'offline' ? (
          <OfflineEmptyState onRetry={() => void query.refetch()} />
        ) : connectivity === 'server-unreachable' || query.error ? (
          <ApiErrorEmptyState onRetry={() => void query.refetch()} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-3">
            {[0, 1, 2].map((index) => (
              <Card key={index} className="shadow-none">
                <CardContent spacing="standalone">
                  <Skeleton className="h-24" />
                </CardContent>
              </Card>
            ))}
          </div>
        )
      ) : (
        <>
          {query.error && !isDefault && (
            <ApiErrorEmptyState
              variant="plain"
              onRetry={() => void query.refetch()}
            />
          )}
          {data.coverage.unavailableLedgerCount > 0 && (
            <output className="block text-sm text-muted-foreground">
              {t('partial')}
            </output>
          )}
          {selected && currency ? (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                <StatsSummaryCard
                  title={t('expenses')}
                  amount={selected.expenses}
                  currency={currency}
                  icon={ReceiptText}
                  isPending={query.isFetching}
                />
                <StatsSummaryCard
                  title={t('income')}
                  amount={selected.income}
                  currency={currency}
                  icon={Coins}
                  isPending={query.isFetching}
                />
                <StatsSummaryCard
                  title={t('net')}
                  amount={selected.netSpending}
                  currency={currency}
                  icon={TrendingDown}
                  isPending={query.isFetching}
                />
              </div>
              {selected.transactionCount === 0 ? (
                <Card className="border-dashed shadow-none">
                  <CardContent
                    spacing="standalone"
                    className="flex min-h-48 flex-col items-center justify-center gap-3 text-center"
                  >
                    <ChartNoAxesCombined
                      className="size-8 text-primary/60"
                      aria-hidden
                    />
                    <p className="text-sm text-muted-foreground">
                      {t('empty')}
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <>
                  <Card className="relative overflow-hidden shadow-none">
                    <CardContent
                      spacing="standalone"
                      aria-busy={query.isFetching}
                    >
                      <Suspense fallback={<Skeleton className="h-76" />}>
                        <HomeStatsChart
                          timeline={selected.timeline}
                          currency={currency}
                          granularity={data.granularity}
                        />
                      </Suspense>
                    </CardContent>
                  </Card>
                  <HomeStatsBreakdown
                    selected={selected}
                    groups={initial.groups}
                    currency={currency}
                  />
                </>
              )}
            </>
          ) : (
            <Card className="border-dashed shadow-none">
              <CardContent
                spacing="standalone"
                className="py-12 text-center text-sm text-muted-foreground"
              >
                {t('empty')}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </section>
  )
}

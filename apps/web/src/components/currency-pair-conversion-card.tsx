/* oxlint-disable jsx-a11y/prefer-tag-over-role, jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events -- custom radio controls and event-isolating wrappers preserve keyboard behavior. */
import {
  AlertTriangle,
  Calendar,
  Globe,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { CurrencyIcon } from '@/components/currency-icon'
import { CurrencyRateProviderAttribution } from '@/components/currency-rate-provider-attribution'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DateInput } from '@/components/ui/date-input'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useCurrencyRates } from '@/lib/hooks'
import { cn } from '@/lib/utils'

export type PairConversionMode = 'perDate' | 'fixed'

export type CurrencyPair = {
  base: string
  target: string
  dates: string[]
}

export function rateItemKey(item: {
  date: string
  base: string
  target: string
}) {
  return `${item.date}|${item.base}|${item.target}`
}

export function pairKey(pair: Pick<CurrencyPair, 'base' | 'target'>) {
  return `${pair.base}|${pair.target}`
}

export function uniquePairs(
  items: Array<{ date: string; base: string; target: string }>,
): CurrencyPair[] {
  const map = new Map<string, CurrencyPair>()
  const seenDates = new Map<string, Set<string>>()
  for (const { date, base, target } of items) {
    const key = `${base}|${target}`
    const pair = map.get(key)
    if (pair) {
      const dates = seenDates.get(key)!
      if (!dates.has(date)) {
        dates.add(date)
        pair.dates.push(date)
      }
    } else {
      map.set(key, { base, target, dates: [date] })
      seenDates.set(key, new Set([date]))
    }
  }
  return [...map.values()]
}

function SelectionDot({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden="true"
      data-state={selected ? 'checked' : 'unchecked'}
      className={cn(
        'inline-flex size-4 shrink-0 items-center justify-center rounded-full border transition-all duration-150',
        selected
          ? 'border-primary bg-primary'
          : 'border-border bg-background group-hover:border-foreground/30',
      )}
    >
      <span
        className={cn(
          'size-1.5 rounded-full bg-primary-foreground transition-opacity duration-150',
          selected ? 'opacity-100' : 'opacity-0',
        )}
      />
    </span>
  )
}

export function OptionCard({
  icon: Icon,
  title,
  helper,
  selected,
  onClick,
  children,
}: {
  icon: typeof Calendar
  title: string
  helper: string
  selected: boolean
  onClick: () => void
  children?: React.ReactNode
}) {
  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-md border bg-card transition-colors duration-150',
        'focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-card',
        selected
          ? 'cursor-default border-primary/60 bg-primary/4'
          : 'cursor-pointer border-border bg-background hover:border-foreground/25 hover:bg-muted/30',
      )}
    >
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        data-state={selected ? 'checked' : 'unchecked'}
        onClick={onClick}
        className={cn(
          'flex w-full items-start gap-3 p-3 text-start',
          'focus-visible:outline-hidden',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md transition-colors duration-150',
            selected
              ? 'bg-primary/10 text-primary'
              : 'bg-muted text-muted-foreground group-hover:text-foreground',
          )}
        >
          <Icon size={16} strokeWidth={2} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-tight font-medium">{title}</p>
          <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
            {helper}
          </p>
        </div>
        <SelectionDot selected={selected} />
      </button>
      {selected && children && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="border-t border-dashed border-border/60 px-3 py-3"
        >
          {children}
        </div>
      )}
    </div>
  )
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-1">
      <span
        aria-hidden="true"
        className="inline-block size-1.5 shrink-0 rounded-full bg-primary/60"
      />
      <p className="font-mono text-[11px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
        {children}
      </p>
    </div>
  )
}

/**
 * Per-pair rate card shared by the group importer and the currency swap.
 * `perDate` uses pre-fetched per-expense-date rates; `fixed` resolves one
 * date's rate (preloaded with today) with an optional typed override.
 */
export function PairConversionCard({
  pair,
  pairKey,
  mode,
  date,
  override,
  fixedRate,
  onFixedRate,
  perDateValues: _perDateValues,
  perDateFetching,
  perDateError,
  onRefreshPerDate,
  onModeChange,
  onDateChange,
  onOverrideChange,
}: {
  pair: CurrencyPair
  pairKey: string
  mode: PairConversionMode
  date: string
  override: number | null | undefined
  fixedRate: number | undefined
  onFixedRate: (r: number) => void
  perDateValues: Record<string, number> | null
  perDateFetching: boolean
  perDateError: boolean
  onRefreshPerDate: () => void
  onModeChange: (m: PairConversionMode) => void
  onDateChange: (d: string) => void
  onOverrideChange: (v: number | null | undefined) => void
}) {
  const { t } = useTranslation()

  const fixedItems = useMemo(
    () => [{ date, base: pair.base, target: pair.target }],
    [date, pair.base, pair.target],
  )
  const fixedQuery = useCurrencyRates(fixedItems, {
    enabled: mode === 'fixed',
  })
  const apiRate = fixedQuery.data?.[0]?.ok ? fixedQuery.data[0].rate.rate : null
  const fixedResultError = fixedQuery.data?.[0]?.ok === false
  const prevApiRate = useRef(apiRate)
  useEffect(() => {
    if (apiRate !== null && apiRate !== prevApiRate.current) {
      prevApiRate.current = apiRate
      onFixedRate(apiRate)
    }
  }, [apiRate, onFixedRate])
  const fixedFetching = fixedQuery.isLoading || fixedQuery.isFetching
  const fixedError = !!fixedQuery.error || fixedResultError
  const useCustomRate = override !== undefined
  // The checkbox stays enabled even when the fetch fails, so custom mode is
  // always reachable as a fallback. `null` means checked-but-empty: enabling
  // without a fetched rate seeds an empty input for the user to fill in.
  const customSeed = fixedRate ?? apiRate ?? null

  return (
    <div className="flex flex-col gap-3">
      <SectionLabel>
        <span className="inline-flex items-center gap-1.5">
          <CurrencyIcon code={pair.base} className="w-4" />
          <span>{pair.base}</span>
          <span aria-hidden="true">→</span>
          <CurrencyIcon code={pair.target} className="w-4" />
          <span>{pair.target}</span>
        </span>
      </SectionLabel>

      <div className="flex flex-col gap-2">
        <OptionCard
          icon={Calendar}
          title={t('Groups.Import.CurrencyConversion.perDateTitle')}
          helper={t('Groups.Import.CurrencyConversion.perDateDescription')}
          selected={mode === 'perDate'}
          onClick={() => onModeChange('perDate')}
        >
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {perDateFetching ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>
                  {t('Groups.Import.CurrencyConversion.fetchingRates')}
                </span>
              </>
            ) : perDateError ? (
              <>
                <AlertTriangle className="h-3 w-3 text-destructive" />
                <span className="text-destructive">
                  {t('Groups.Import.CurrencyConversion.ratesError')}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onRefreshPerDate}
                  className="ms-auto h-8 px-1.5 text-xs"
                >
                  <RefreshCw className="h-3 w-3" />
                  <span className="ms-1">
                    {t('Groups.Import.CurrencyConversion.refresh')}
                  </span>
                </Button>
              </>
            ) : (
              <span>
                {t('Groups.Import.CurrencyConversion.perDateSelectedHint')}
              </span>
            )}
          </div>
        </OptionCard>

        <OptionCard
          icon={Globe}
          title={t('Groups.Import.CurrencyConversion.fixedTitle')}
          helper={t('Groups.Import.CurrencyConversion.fixedDescription')}
          selected={mode === 'fixed'}
          onClick={() => onModeChange('fixed')}
        >
          <div className="flex flex-col gap-2.5 text-xs">
            <div className="flex items-center gap-3">
              <Checkbox
                id={`custom-rate-${pairKey}`}
                checked={useCustomRate}
                onCheckedChange={(checked) => {
                  if (checked) {
                    onOverrideChange(customSeed)
                  } else {
                    onOverrideChange(undefined)
                  }
                }}
              />
              <Label
                htmlFor={`custom-rate-${pairKey}`}
                className="cursor-pointer text-xs font-normal"
              >
                {t('Groups.Import.CurrencyConversion.customRateLabel')}
              </Label>
            </div>

            {!useCustomRate ? (
              <>
                <div className="flex items-center gap-3">
                  <Label
                    htmlFor={`rate-date-${pairKey}`}
                    className="shrink-0 text-xs font-normal"
                  >
                    {t('Groups.Import.CurrencyConversion.rateDateLabel')}
                  </Label>
                  <DateInput
                    id={`rate-date-${pairKey}`}
                    pickerTitle={t(
                      'Groups.Import.CurrencyConversion.rateDateLabel',
                    )}
                    value={date}
                    required
                    onValueChange={onDateChange}
                    className="h-8 max-w-[160px] font-mono text-xs tabular-nums"
                  />
                  {fixedFetching && !fixedRate && (
                    <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                  )}
                </div>

                {fixedRate !== undefined && (
                  <div className="flex items-center gap-1.5 rounded-md border border-border/50 bg-muted/30 px-2.5 py-1.5">
                    <span className="font-mono text-xs text-foreground tabular-nums">
                      {t('Groups.Import.CurrencyConversion.fixedRateRow', {
                        source: pair.base,
                        rate: fixedRate.toFixed(4),
                        target: pair.target,
                      })}
                    </span>
                  </div>
                )}

                {fixedError && !fixedFetching && (
                  <div className="flex items-center gap-2 text-xs text-destructive">
                    <AlertTriangle className="h-3 w-3" />
                    <span>
                      {t('Groups.Import.CurrencyConversion.ratesError')}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => fixedQuery.refetch()}
                      className="ms-auto h-6 px-1.5 text-xs"
                    >
                      <RefreshCw className="h-3 w-3" />
                      <span className="ms-1">
                        {t('Groups.Import.CurrencyConversion.refresh')}
                      </span>
                    </Button>
                  </div>
                )}
                {fixedQuery.data?.[0]?.ok ? (
                  <CurrencyRateProviderAttribution
                    className="text-[10px] text-muted-foreground/50"
                    sources={fixedQuery.data[0].rate.sources}
                    via={fixedQuery.data[0].rate.via}
                  />
                ) : null}
              </>
            ) : (
              <div className="flex items-center gap-3">
                <Label
                  htmlFor={`custom-rate-input-${pairKey}`}
                  className="shrink-0 text-xs font-normal"
                >
                  {t('Groups.Import.CurrencyConversion.customRateLabel')}
                </Label>
                <Input
                  id={`custom-rate-input-${pairKey}`}
                  type="number"
                  step="any"
                  value={override ?? ''}
                  onFocus={(e) => {
                    e.target.select()
                  }}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value)
                    onOverrideChange(isNaN(v) ? null : v)
                  }}
                  className="h-8 max-w-[120px] font-mono text-xs tabular-nums"
                />
                <span className="font-mono text-xs text-muted-foreground">
                  {pair.target}
                </span>
              </div>
            )}
          </div>
        </OptionCard>
      </div>
    </div>
  )
}

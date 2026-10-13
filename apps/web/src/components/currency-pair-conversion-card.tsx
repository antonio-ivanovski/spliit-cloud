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
import {
  CurrencyRateWarning,
  CurrencyWithdrawnNotice,
} from '@/components/currency-rate-warning'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DateInput } from '@/components/ui/date-input'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useCurrencyRates, type CurrencyRatesResponse } from '@/lib/hooks'
import { cn } from '@/lib/utils'
import {
  fixedConversionFor,
  getCurrencyRateWarning,
  withdrawnDetailsFor,
} from '@spliit/domain/currency'

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

/** Per-pair outcome counts for the per-date prefetch, derived from sources. */
export type PairRateSummary = {
  market: number
  fallback: number
  failed: number
  total: number
}

type OkRateResult = Extract<CurrencyRatesResponse[number], { ok: true }>

/**
 * True when a resolved rate came from a withdrawn-currency fallback (any
 * `fixed` leg, or a quote frozen at the last pre-withdrawal date for a
 * post-withdrawal request) rather than a genuine market quote. Mirrors the API
 * engine's `isFallbackComposed` so strict pairs can filter fallback-composed
 * entries out of shared/cached batch data client-side.
 */
export function rateResultUsesFallback(
  result: CurrencyRatesResponse[number] | undefined,
): result is OkRateResult {
  if (!result || !result.ok) return false
  const { rate } = result
  if (rate.sources.some((source) => source.provider === 'fixed')) return true
  for (const code of [rate.base, rate.target]) {
    const from = fixedConversionFor(code)?.effectiveFrom
    if (from && rate.requestedDate >= from && rate.asOfDate < from) return true
  }
  return false
}

function isOkRateResult(
  result: CurrencyRatesResponse[number] | undefined,
): result is OkRateResult {
  return !!result && result.ok
}

/**
 * Classify one pair's slice of a batch prefetch: per-date values (excluding
 * fallback-composed entries when the pair is strict), failed keys, and the
 * market/fallback/failed summary the card renders. Returns a null summary while
 * the batch is still loading or stale.
 */
export function classifyPairResults(
  pair: Pick<CurrencyPair, 'base' | 'target'>,
  items: Array<{ date: string; base: string; target: string }>,
  results: CurrencyRatesResponse | undefined,
  fallbackEnabled: boolean,
): {
  values: Record<string, number>
  failedKeys: Set<string>
  summary: PairRateSummary | null
} {
  const values: Record<string, number> = {}
  const failedKeys = new Set<string>()
  if (!results || results.length !== items.length) {
    return { values, failedKeys, summary: null }
  }
  let market = 0
  let fallback = 0
  let failed = 0
  let total = 0
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!
    if (item.base !== pair.base || item.target !== pair.target) continue
    total++
    const key = rateItemKey(item)
    const result = results[i]
    if (!isOkRateResult(result)) {
      failed++
      failedKeys.add(key)
      continue
    }
    if (rateResultUsesFallback(result)) {
      // Strict pairs treat fallback-composed entries as missing (the server
      // already resolves strict items as RATE_NOT_FOUND; this covers shared
      // or cached fallback entries).
      if (!fallbackEnabled) {
        failed++
        failedKeys.add(key)
        continue
      }
      fallback++
    } else {
      market++
    }
    values[key] = result.rate.rate
  }
  return { values, failedKeys, summary: { market, fallback, failed, total } }
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
 * Withdrawn-pair notice inside the per-date option. Strict pairs always get the
 * full warning; fallback-allowed pairs collapse to a compact "{n} of {total}
 * dates use the fixed conversion" line plus the statutory detail once counts
 * are known (all-market pairs stay quiet — the selected hint above already
 * covers them).
 */
function WithdrawnPerDateNotice({
  details,
  fallbackEnabled,
  summary,
  hasError,
}: {
  details: Parameters<typeof CurrencyWithdrawnNotice>[0]['details']
  fallbackEnabled: boolean
  summary: PairRateSummary | null | undefined
  hasError: boolean
}) {
  const { t } = useTranslation()
  const compact =
    fallbackEnabled && !!summary && summary.fallback > 0 && !hasError
  const show = !fallbackEnabled || !summary || summary.fallback > 0 || hasError
  if (!show) return null
  return (
    <CurrencyWithdrawnNotice
      details={details}
      hideHeadline={compact}
      summary={
        compact && summary
          ? t('Groups.Import.CurrencyConversion.perDateFallbackSummary', {
              fallback: summary.fallback,
              total: summary.total,
            })
          : undefined
      }
    />
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
  fallbackEnabled = true,
  onFallbackChange,
  perDateSummary = null,
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
  /**
   * Per-date fixed-fallback opt-in, shown only for withdrawn pairs. Defaults to
   * true (historical always-fallback behavior); false resolves post-withdrawal
   * dates as missing instead.
   */
  fallbackEnabled?: boolean
  onFallbackChange?: (enabled: boolean) => void
  /** Market/fallback/failed counts for this pair's per-date prefetch. */
  perDateSummary?: PairRateSummary | null
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
  const fixedRateResult = fixedQuery.data?.[0]?.ok
    ? fixedQuery.data[0].rate
    : null
  const fixedWarning =
    mode === 'fixed' && fixedRateResult
      ? getCurrencyRateWarning({
          base: pair.base,
          target: pair.target,
          requestedDate: fixedRateResult.requestedDate,
          asOfDate: fixedRateResult.asOfDate,
          sources: fixedRateResult.sources,
        })
      : null
  // Pair-level notice for per-date mode: no single resolved rate exists, but
  // the catalog alone tells us a withdrawn code is involved.
  const withdrawnDetails = useMemo(
    () => withdrawnDetailsFor([pair.base, pair.target]),
    [pair.base, pair.target],
  )
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
          <div className="flex flex-col gap-2.5">
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
            {withdrawnDetails.length > 0 ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-3">
                  <Checkbox
                    id={`fallback-${pairKey}`}
                    checked={fallbackEnabled}
                    onCheckedChange={(checked) => {
                      onFallbackChange?.(checked === true)
                    }}
                  />
                  <Label
                    htmlFor={`fallback-${pairKey}`}
                    className="cursor-pointer text-xs font-normal"
                  >
                    {t('Groups.Import.CurrencyConversion.perDateFallbackLabel')}
                  </Label>
                </div>
                <WithdrawnPerDateNotice
                  details={withdrawnDetails}
                  fallbackEnabled={fallbackEnabled}
                  summary={perDateSummary}
                  hasError={perDateError}
                />
              </div>
            ) : null}
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

                <CurrencyRateWarning warning={fixedWarning} />

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

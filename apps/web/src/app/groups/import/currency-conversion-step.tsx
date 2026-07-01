import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useCurrencyRates } from '@/lib/hooks'
import { cn } from '@/lib/utils'
import type {
  NormalizedSource,
  NormalizedSourceExpense,
} from '@spliit/domain/import'
import { computeImportRateKeys } from '@spliit/domain/import'
import {
  AlertTriangle,
  Calendar,
  Check,
  Globe,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ConversionMode } from './import-wizard-state'

// ----- types -----

export type ConversionResult = {
  modes: Record<string, ConversionMode>
  fixedRateDates: Record<string, string>
  fixedRateOverrides: Record<string, number>
  rates: Record<string, number>
}

type Props = {
  source: NormalizedSource
  resolvedExpenses: NormalizedSourceExpense[]
  sourceCurrencyCode: string
  destinationCurrencyCode: string
  conversionModes: Record<string, ConversionMode>
  fixedRateDates: Record<string, string>
  fixedRateOverrides: Record<string, number>
  /** Previously computed rates (date|base|target -> rate). Used to
   *  pre-populate fixed-rate values when the user navigates back. */
  initialRates: Record<string, number>
  onContinue: (result: ConversionResult) => void
  registerStepNav: (
    step: 'currencyConversion',
    nav: { onContinue?: () => void; disabled?: boolean },
  ) => void
}

type CurrencyPair = {
  base: string
  target: string
  dates: string[]
}

// ----- helpers -----

function uniquePairs(
  items: Array<{ date: string; base: string; target: string }>,
): CurrencyPair[] {
  const map = new Map<string, CurrencyPair>()
  for (const { date, base, target } of items) {
    const key = `${base}|${target}`
    const pair = map.get(key)
    if (pair) {
      if (!pair.dates.includes(date)) pair.dates.push(date)
    } else {
      map.set(key, { base, target, dates: [date] })
    }
  }
  return [...map.values()]
}

// ----- sub-components -----

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

function OptionCard({
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
          ? 'cursor-default border-primary/60 bg-primary/[0.04]'
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
          'flex w-full items-start gap-3 p-3 text-left',
          'focus-visible:outline-none',
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
          <p className="text-sm font-medium leading-tight">{title}</p>
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

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2 px-1">
      <span
        aria-hidden="true"
        className="inline-block size-1.5 translate-y-[-1px] rounded-full bg-primary/60"
      />
      <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {children}
      </p>
    </div>
  )
}

// ----- per-pair card -----

function PairConversionCard({
  pair,
  pairKey,
  mode,
  date,
  override,
  fixedRate,
  onFixedRate,
  perDateValues,
  perDateFetching,
  perDateError,
  onRefreshPerDate,
  onModeChange,
  onDateChange,
  onOverrideChange,
}: {
  pair: CurrencyPair
  pairKey: string
  mode: ConversionMode
  date: string
  override: number | undefined
  fixedRate: number | undefined
  onFixedRate: (r: number) => void
  perDateValues: Record<string, number> | null
  perDateFetching: boolean
  perDateError: boolean
  onRefreshPerDate: () => void
  onModeChange: (m: ConversionMode) => void
  onDateChange: (d: string) => void
  onOverrideChange: (v: number | undefined) => void
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
  const prevApiRate = useRef(apiRate)
  useEffect(() => {
    if (apiRate !== null && apiRate !== prevApiRate.current) {
      prevApiRate.current = apiRate
      onFixedRate(apiRate)
    }
  }, [apiRate, onFixedRate])
  const fixedFetching = fixedQuery.isLoading || fixedQuery.isFetching
  const fixedError = !!fixedQuery.error
  const useCustomRate = override !== undefined

  return (
    <div className="flex flex-col gap-3">
      <SectionLabel>
        {pair.base} → {pair.target}
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
                  className="ml-auto h-6 px-1.5 text-xs"
                >
                  <RefreshCw className="h-3 w-3" />
                  <span className="ml-1">
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
                    const seed = fixedRate ?? apiRate ?? undefined
                    onOverrideChange(seed)
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
                  <Input
                    id={`rate-date-${pairKey}`}
                    type="date"
                    value={date}
                    onChange={(e) => onDateChange(e.target.value)}
                    className="h-8 max-w-[160px] font-mono text-xs tabular-nums"
                  />
                  {fixedFetching && !fixedRate && (
                    <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                  )}
                </div>

                {fixedRate !== undefined && (
                  <div className="flex items-center gap-1.5 rounded-md border border-border/50 bg-muted/30 px-2.5 py-1.5">
                    <span className="font-mono text-xs tabular-nums text-foreground">
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
                      className="ml-auto h-6 px-1.5 text-xs"
                    >
                      <RefreshCw className="h-3 w-3" />
                      <span className="ml-1">
                        {t('Groups.Import.CurrencyConversion.refresh')}
                      </span>
                    </Button>
                  </div>
                )}
                <p className="text-[10px] text-muted-foreground/50">
                  {t('Groups.Import.CurrencyConversion.viaFrankfurter')}
                </p>
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
                  onChange={(e) => {
                    const v = parseFloat(e.target.value)
                    onOverrideChange(isNaN(v) ? undefined : v)
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

// ----- main component -----

export function CurrencyConversionStep({
  source,
  resolvedExpenses,
  sourceCurrencyCode,
  destinationCurrencyCode,
  conversionModes: initialModes,
  fixedRateDates: initialDates,
  fixedRateOverrides: initialOverrides,
  initialRates,
  onContinue,
  registerStepNav,
}: Props) {
  const { t } = useTranslation()

  const rateKeyItems = useMemo(
    () =>
      computeImportRateKeys(
        resolvedExpenses,
        sourceCurrencyCode,
        destinationCurrencyCode,
      ),
    [resolvedExpenses, sourceCurrencyCode, destinationCurrencyCode],
  )

  const pairs = useMemo(() => uniquePairs(rateKeyItems), [rateKeyItems])
  const noConversionNeeded = pairs.length === 0

  const [modes, setModes] = useState<Record<string, ConversionMode>>(() => {
    const defaults: Record<string, ConversionMode> = {}
    for (const pair of pairs)
      defaults[`${pair.base}|${pair.target}`] = 'perDate'
    return { ...defaults, ...initialModes }
  })
  const [dates, setDates] = useState<Record<string, string>>(initialDates)
  const [overrides, setOverrides] =
    useState<Record<string, number>>(initialOverrides)
  const [fixedRates, setFixedRates] = useState<Record<string, number>>(() => {
    // Pre-populate from previously computed rates so navigating back
    // doesn't leave fixed-mode pairs waiting for a re-fetch.
    const out: Record<string, number> = {}
    for (const key of Object.keys(initialRates)) {
      const [, base, target] = key.split('|')
      const pairKey = `${base}|${target}`
      if (out[pairKey] === undefined) out[pairKey] = initialRates[key]
    }
    return out
  })

  const ensureMode = useCallback((pairKey: string) => {
    setModes((prev) =>
      prev[pairKey] ? prev : { ...prev, [pairKey]: 'perDate' },
    )
    setDates((prev) =>
      prev[pairKey]
        ? prev
        : { ...prev, [pairKey]: new Date().toISOString().slice(0, 10) },
    )
  }, [])

  useEffect(() => {
    if (pairs.length === 0) return
    const today = new Date().toISOString().slice(0, 10)
    setModes((prev) => {
      const next = { ...prev }
      let changed = false
      for (const pair of pairs) {
        const key = `${pair.base}|${pair.target}`
        if (!next[key]) {
          next[key] = 'perDate'
          changed = true
        }
      }
      return changed ? next : prev
    })
    setDates((prev) => {
      const next = { ...prev }
      let changed = false
      for (const pair of pairs) {
        const key = `${pair.base}|${pair.target}`
        if (!next[key]) {
          next[key] = today
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [pairs])

  // Pre-fetch per-date rates for the rate computation.
  const perDateQuery = useCurrencyRates(rateKeyItems, {
    enabled: rateKeyItems.length > 0,
  })
  const perDateValues = useMemo(() => {
    if (!perDateQuery.data) return null
    const out: Record<string, number> = {}
    for (let i = 0; i < rateKeyItems.length; i++) {
      const item = rateKeyItems[i]
      const result = perDateQuery.data[i]
      if (result?.ok)
        out[`${item.date}|${item.base}|${item.target}`] = result.rate.rate
    }
    return out
  }, [perDateQuery.data, rateKeyItems])

  // Track whether every needed rate is ready, so we can disable Continue.
  const perDateReady = useMemo(() => {
    if (
      pairs.some(
        (p) => (modes[`${p.base}|${p.target}`] ?? 'perDate') === 'perDate',
      )
    ) {
      if (!perDateValues) return false
      for (const pair of pairs) {
        const pairMode = modes[`${pair.base}|${pair.target}`] ?? 'perDate'
        if (pairMode !== 'perDate') continue
        for (const d of pair.dates) {
          if (perDateValues[`${d}|${pair.base}|${pair.target}`] === undefined)
            return false
        }
      }
    }
    return true
  }, [pairs, modes, perDateValues])

  const fixedReady = useMemo(() => {
    let ready = true
    for (const pair of pairs) {
      const pairKey = `${pair.base}|${pair.target}`
      const pairMode = modes[pairKey] ?? 'perDate'
      if (pairMode !== 'fixed') continue
      const value = overrides[pairKey] ?? fixedRates[pairKey]
      if (value === undefined) {
        ready = false
        break
      }
    }
    return ready
  }, [pairs, modes, overrides, fixedRates])

  const canContinue = noConversionNeeded || (perDateReady && fixedReady)

  function handleContinue() {
    if (!canContinue) return

    if (noConversionNeeded) {
      onContinue({
        modes: {},
        fixedRateDates: {},
        fixedRateOverrides: {},
        rates: {},
      })
      return
    }

    const rates: Record<string, number> = {}
    for (const pair of pairs) {
      const pairKey = `${pair.base}|${pair.target}`
      const pairMode = modes[pairKey] || 'perDate'

      if (pairMode === 'perDate' && perDateValues) {
        for (const d of pair.dates) {
          const key = `${d}|${pair.base}|${pair.target}`
          const rate = perDateValues[key]
          if (rate !== undefined) rates[key] = rate
        }
      } else if (pairMode === 'fixed') {
        const rate = overrides[pairKey] ?? fixedRates[pairKey]
        if (rate !== undefined) {
          for (const item of rateKeyItems) {
            if (item.base === pair.base && item.target === pair.target) {
              rates[`${item.date}|${item.base}|${item.target}`] = rate
            }
          }
        }
      }
    }

    onContinue({
      modes,
      fixedRateDates: dates,
      fixedRateOverrides: overrides,
      rates,
    })
  }

  useEffect(() => {
    registerStepNav('currencyConversion', {
      onContinue: handleContinue,
      disabled: !canContinue,
    })
  }, [canContinue, registerStepNav, handleContinue])

  return (
    <div className="flex flex-col gap-6">
      {noConversionNeeded ? (
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <Check className="h-5 w-5 shrink-0 text-green-600" />
            <p className="text-sm">
              {t('Groups.Import.CurrencyConversion.noConversionNeeded')}
            </p>
          </CardContent>
        </Card>
      ) : (
        pairs.map((pair) => {
          const pairKey = `${pair.base}|${pair.target}`
          return (
            <Card key={pairKey} className="overflow-hidden">
              <CardContent className="p-4">
                <PairConversionCard
                  pair={pair}
                  pairKey={pairKey}
                  mode={modes[pairKey] || 'perDate'}
                  date={dates[pairKey] || new Date().toISOString().slice(0, 10)}
                  override={overrides[pairKey]}
                  fixedRate={fixedRates[pairKey]}
                  onFixedRate={(r) =>
                    setFixedRates((p) => ({ ...p, [pairKey]: r }))
                  }
                  perDateValues={perDateValues}
                  perDateFetching={
                    perDateQuery.isLoading || perDateQuery.isFetching
                  }
                  perDateError={!!perDateQuery.error}
                  onRefreshPerDate={() => perDateQuery.refetch()}
                  onModeChange={(m) => {
                    ensureMode(pairKey)
                    setModes((p) => ({ ...p, [pairKey]: m }))
                  }}
                  onDateChange={(d) =>
                    setDates((p) => ({ ...p, [pairKey]: d }))
                  }
                  onOverrideChange={(v) =>
                    setOverrides((p) => {
                      const next = { ...p }
                      if (v === undefined) delete next[pairKey]
                      else next[pairKey] = v
                      return next
                    })
                  }
                />
              </CardContent>
            </Card>
          )
        })
      )}
    </div>
  )
}

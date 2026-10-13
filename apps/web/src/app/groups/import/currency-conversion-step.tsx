import { Check } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  PairConversionCard,
  classifyPairResults,
  pairKey,
  rateItemKey,
  rateResultUsesFallback,
  uniquePairs,
  type PairRateSummary,
} from '@/components/currency-pair-conversion-card'
import { Card, CardContent } from '@/components/ui/card'
import { useCurrencyRates } from '@/lib/hooks'
import type {
  NormalizedSource,
  NormalizedSourceExpense,
} from '@spliit/domain/import'
import { computeImportRateKeys } from '@spliit/domain/import'

import {
  supportsDocumentRecovery,
  type ConversionMode,
} from './import-wizard-state'
import { WizardNav } from './wizard-nav'

// ----- types -----

export type ConversionResult = {
  modes: Record<string, ConversionMode>
  fixedRateDates: Record<string, string>
  fixedRateOverrides: Record<string, number>
  rates: Record<string, number>
  /** Rate keys (`date|BASE|TARGET`) resolved via fixed fallback, if any. */
  fallbackKeys: string[]
}

type Props = {
  source: NormalizedSource
  resolvedExpenses: NormalizedSourceExpense[]
  sourceCurrencyCode: string
  destinationCurrencyCode: string
  conversionModes: Record<string, ConversionMode>
  fixedRateDates: Record<string, string>
  fixedRateOverrides: Record<string, number>
  /**
   * Previously computed rates (date|base|target -> rate). Used to pre-populate
   * fixed-rate values when the user navigates back.
   */
  initialRates: Record<string, number>
  /** Cloud restores use the source ledger currency and never apply FX here. */
  currencyLocked?: boolean
  onBack: () => void
  onContinue: (result: ConversionResult) => void
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
  currencyLocked = false,
  onBack,
  onContinue,
}: Props) {
  const { t } = useTranslation()

  // Per-date fixed fallback per pair (withdrawn pairs only in the UI).
  // Absent = allow (the historical always-fallback behavior). Declared before
  // `rateKeyItems` because the prefetch flags strict pairs server-side.
  const [fallbacks, setFallbacks] = useState<Record<string, boolean>>({})

  const rateKeyItems = useMemo(
    () =>
      currencyLocked
        ? []
        : computeImportRateKeys(
            resolvedExpenses,
            sourceCurrencyCode,
            destinationCurrencyCode,
          ).map((item) =>
            fallbacks[`${item.base}|${item.target}`] === false
              ? { ...item, allowFixedFallback: false as const }
              : item,
          ),
    [
      currencyLocked,
      resolvedExpenses,
      sourceCurrencyCode,
      destinationCurrencyCode,
      fallbacks,
    ],
  )

  const pairs = useMemo(() => uniquePairs(rateKeyItems), [rateKeyItems])
  const noConversionNeeded = pairs.length === 0

  const [modes, setModes] = useState<Record<string, ConversionMode>>(() => {
    const defaults: Record<string, ConversionMode> = {}
    for (const pair of pairs) defaults[pairKey(pair)] = 'perDate'
    return { ...defaults, ...initialModes }
  })
  // Initialise dates with defaults for every pair.  The per-pair entries
  // are populated once so we can skip the cascading-render effect below.
  const [dates, setDates] = useState<Record<string, string>>(() => {
    const defaults: Record<string, string> = { ...initialDates }
    const today = new Date().toISOString().slice(0, 10)
    for (const pair of pairs) {
      const key = pairKey(pair)
      if (!(key in defaults)) defaults[key] = today
    }
    return defaults
  })
  const [overrides, setOverrides] =
    useState<Record<string, number | null>>(initialOverrides)
  const [fixedRates, setFixedRates] = useState<Record<string, number>>(() => {
    // Pre-populate from previously computed rates so navigating back
    // doesn't leave fixed-mode pairs waiting for a re-fetch.
    const out: Record<string, number> = {}
    for (const rateKey of Object.keys(initialRates)) {
      const [, base, target] = rateKey.split('|')
      const key = `${base}|${target}`
      if (out[key] === undefined) out[key] = initialRates[rateKey]
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

  // Ensure every pair has a mode and date entry.  This runs during
  // render (not in an effect) so it merges with the current React batch
  // instead of triggering a cascading render.  Once a key is registered
  // the guard short-circuits, so this does not loop.
  if (pairs.length > 0) {
    let needsModeUpdate = false
    for (const pair of pairs) {
      if (!(pairKey(pair) in modes)) {
        needsModeUpdate = true
        break
      }
    }
    if (needsModeUpdate) {
      setModes((prev) => {
        const next = { ...prev }
        for (const pair of pairs) {
          const key = pairKey(pair)
          if (!(key in next)) next[key] = 'perDate'
        }
        return next
      })
    }
  }

  // Pre-fetch per-date rates for the rate computation. Strict pairs
  // (fallback off) ask the server for market-only rates; the client filter
  // below additionally drops fallback-composed entries from shared data.
  const perDateQuery = useCurrencyRates(rateKeyItems, {
    enabled: rateKeyItems.length > 0,
  })
  const perDateClassification = useMemo(() => {
    const data = perDateQuery.data
    if (!data || data.length !== rateKeyItems.length) return null
    const values: Record<string, number> = {}
    const failed = new Set<string>()
    const summaries = new Map<string, PairRateSummary>()
    for (const pair of pairs) {
      const key = `${pair.base}|${pair.target}`
      const classified = classifyPairResults(
        pair,
        rateKeyItems,
        data,
        fallbacks[key] ?? true,
      )
      Object.assign(values, classified.values)
      for (const failedKey of classified.failedKeys) failed.add(failedKey)
      if (classified.summary) summaries.set(key, classified.summary)
    }
    return { values, failed, summaries }
  }, [pairs, rateKeyItems, perDateQuery.data, fallbacks])
  const perDateValues = perDateClassification?.values ?? null

  const perDateFailedKeys: Set<string> = useMemo(() => {
    if (perDateClassification) return perDateClassification.failed
    // While loading, fall back to raw failures so the card can show errors
    // without waiting for classification.
    if (!perDateQuery.data) return new Set<string>()
    const failed = new Set<string>()
    for (let i = 0; i < rateKeyItems.length; i++) {
      const item = rateKeyItems[i]
      const result = perDateQuery.data[i]
      if (result?.ok === false) failed.add(rateItemKey(item))
    }
    return failed
  }, [perDateClassification, perDateQuery.data, rateKeyItems])

  // Track whether every needed rate is ready, so we can disable Continue.
  const perDateReady = useMemo(() => {
    if (pairs.some((p) => (modes[pairKey(p)] ?? 'perDate') === 'perDate')) {
      if (!perDateValues) return false
      for (const pair of pairs) {
        const pairMode = modes[pairKey(pair)] ?? 'perDate'
        if (pairMode !== 'perDate') continue
        for (const d of pair.dates) {
          if (perDateValues[rateItemKey({ date: d, ...pair })] === undefined)
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
      const override = overrides[pairKey]
      // `null` is checked-empty custom mode: blocks until the user types.
      if (override === null) {
        ready = false
        break
      }
      const value = override ?? fixedRates[pairKey]
      if (value === undefined || value === -1) {
        ready = false
        break
      }
    }
    return ready
  }, [pairs, modes, overrides, fixedRates])

  const canContinue = noConversionNeeded || (perDateReady && fixedReady)

  const handleContinue = useCallback(() => {
    if (!canContinue) return

    if (noConversionNeeded) {
      onContinue({
        modes: {},
        fixedRateDates: {},
        fixedRateOverrides: {},
        rates: {},
        fallbackKeys: [],
      })
      return
    }

    const rates: Record<string, number> = {}
    // Rate keys resolved through the withdrawn-currency fallback (per-date
    // pairs only — fixed-mode provenance stays inside the pair card).
    // Derived from the same prefetch the summary counts use, so the confirm
    // step can flag them without re-resolving anything.
    const fallbackKeys: string[] = []
    const batchData = perDateQuery.data
    if (batchData && batchData.length === rateKeyItems.length) {
      for (let i = 0; i < rateKeyItems.length; i++) {
        const item = rateKeyItems[i]!
        if ((modes[`${item.base}|${item.target}`] ?? 'perDate') !== 'perDate')
          continue
        if (rateResultUsesFallback(batchData[i])) {
          fallbackKeys.push(`${item.date}|${item.base}|${item.target}`)
        }
      }
    }
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
        const override = overrides[pairKey]
        const rate =
          override === null ? undefined : (override ?? fixedRates[pairKey])
        if (rate !== undefined && rate !== -1) {
          for (const item of rateKeyItems) {
            if (item.base === pair.base && item.target === pair.target) {
              rates[`${item.date}|${item.base}|${item.target}`] = rate
            }
          }
        }
      }
    }

    const cleanOverrides: Record<string, number> = {}
    for (const [key, value] of Object.entries(overrides)) {
      if (typeof value === 'number') cleanOverrides[key] = value
    }

    onContinue({
      modes,
      fixedRateDates: dates,
      fixedRateOverrides: cleanOverrides,
      rates,
      fallbackKeys,
    })
  }, [
    canContinue,
    dates,
    fixedRates,
    modes,
    noConversionNeeded,
    onContinue,
    overrides,
    pairs,
    perDateValues,
    perDateQuery.data,
    rateKeyItems,
  ])

  return (
    <div className="flex flex-col gap-6">
      {noConversionNeeded ? (
        <Card>
          <CardContent spacing="standalone" className="flex items-center gap-3">
            <Check className="h-5 w-5 shrink-0 text-green-600" />
            <p className="text-sm">
              {t('Groups.Import.CurrencyConversion.noConversionNeeded')}
            </p>
          </CardContent>
        </Card>
      ) : (
        pairs.map((pair) => {
          const pairKey = `${pair.base}|${pair.target}`
          const hasPerDateResultError = pair.dates.some((date) =>
            perDateFailedKeys.has(rateItemKey({ date, ...pair })),
          )
          return (
            <Card key={pairKey} className="overflow-hidden">
              <CardContent spacing="standalone">
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
                  perDateError={!!perDateQuery.error || hasPerDateResultError}
                  perDateSummary={
                    perDateClassification?.summaries.get(pairKey) ?? null
                  }
                  fallbackEnabled={fallbacks[pairKey] ?? true}
                  onFallbackChange={(v) =>
                    setFallbacks((p) => ({ ...p, [pairKey]: v }))
                  }
                  onRefreshPerDate={() => perDateQuery.refetch()}
                  onModeChange={(m) => {
                    ensureMode(pairKey)
                    setModes((p) => ({ ...p, [pairKey]: m }))
                  }}
                  onDateChange={(d) => {
                    setDates((p) => ({ ...p, [pairKey]: d }))
                    setFixedRates((p) => {
                      if (p[pairKey] === undefined) return p
                      const next = { ...p }
                      delete next[pairKey]
                      return next
                    })
                  }}
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

      <WizardNav
        step="currencyConversion"
        includeDocuments={currencyLocked || supportsDocumentRecovery(source)}
        onBack={onBack}
        onContinue={handleContinue}
        continueDisabled={!canContinue}
      />
    </div>
  )
}

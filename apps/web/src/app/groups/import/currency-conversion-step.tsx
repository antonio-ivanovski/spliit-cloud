import type {
  ConversionPair,
  ConversionPolicy,
  CurrencyConversionWizardResult,
} from '@/components/currency-conversion-wizard'
import { CurrencyConversionWizard } from '@/components/currency-conversion-wizard'
import type {
  NormalizedSource,
  NormalizedSourceExpense,
} from '@spliit/domain/import'
import { computeImportRateKeys } from '@spliit/domain/import'
import { useMemo, useState } from 'react'
import type { ConversionMode } from './import-wizard-state'
import { WizardNav } from './wizard-nav'

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
  initialRates: Record<string, number>
  onBack: () => void
  onContinue: (result: ConversionResult) => void
}

function pairKey(pair: Pick<ConversionPair, 'base' | 'target'>) {
  return `${pair.base}|${pair.target}`
}

export function CurrencyConversionStep({
  source: _source,
  resolvedExpenses,
  sourceCurrencyCode,
  destinationCurrencyCode,
  conversionModes,
  fixedRateDates,
  fixedRateOverrides,
  onBack,
  onContinue,
}: Props) {
  const rateItems = useMemo(
    () =>
      computeImportRateKeys(
        resolvedExpenses,
        sourceCurrencyCode,
        destinationCurrencyCode,
      ),
    [resolvedExpenses, sourceCurrencyCode, destinationCurrencyCode],
  )
  const pairs = useMemo<ConversionPair[]>(() => {
    const byKey = new Map<string, ConversionPair>()
    for (const item of rateItems) {
      const key = `${item.base}|${item.target}`
      const pair = byKey.get(key)
      if (pair) {
        if (!pair.dates.includes(item.date)) pair.dates.push(item.date)
      } else {
        byKey.set(key, {
          base: item.base,
          target: item.target,
          dates: [item.date],
        })
      }
    }
    return [...byKey.values()]
  }, [rateItems])

  const initialPolicies = useMemo<Record<string, ConversionPolicy>>(() => {
    const result: Record<string, ConversionPolicy> = {}
    for (const pair of pairs) {
      const key = pairKey(pair)
      const mode = conversionModes[key] ?? 'perDate'
      if (mode === 'fixed') {
        result[key] =
          fixedRateOverrides[key] !== undefined
            ? { type: 'fixedCustom', rate: fixedRateOverrides[key] }
            : {
                type: 'fixedProvider',
                date:
                  fixedRateDates[key] ?? new Date().toISOString().slice(0, 10),
              }
      } else {
        result[key] = { type: 'perDate' }
      }
    }
    return result
  }, [conversionModes, fixedRateDates, fixedRateOverrides, pairs])

  const [conversion, setConversion] =
    useState<CurrencyConversionWizardResult | null>(null)

  const continueConversion = () => {
    if (!conversion?.ready) return
    const modes: Record<string, ConversionMode> = {}
    const dates: Record<string, string> = {}
    const overrides: Record<string, number> = {}
    for (const [key, policy] of Object.entries(conversion.policies)) {
      if (policy.type === 'perDate') modes[key] = 'perDate'
      else {
        modes[key] = 'fixed'
        if (policy.type === 'fixedProvider') dates[key] = policy.date
        else if (policy.rate !== undefined) overrides[key] = policy.rate
      }
    }
    onContinue({
      modes,
      fixedRateDates: dates,
      fixedRateOverrides: overrides,
      rates: conversion.rates,
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <CurrencyConversionWizard
        pairs={pairs}
        initialPolicies={initialPolicies}
        onChange={setConversion}
      />
      <WizardNav
        step="currencyConversion"
        onBack={onBack}
        onContinue={continueConversion}
        continueDisabled={!conversion?.ready}
      />
    </div>
  )
}

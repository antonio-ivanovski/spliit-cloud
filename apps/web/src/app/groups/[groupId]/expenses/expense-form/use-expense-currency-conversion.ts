import type { Dispatch, SetStateAction } from 'react'
import { useEffect, useState } from 'react'
import type { UseFormReturn } from 'react-hook-form'
import { useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import type { Group } from '@/lib/api'
import { getCurrency, useCurrencies } from '@/lib/currency'
import { useCurrencyRate } from '@/lib/hooks'
import { trpc } from '@/trpc/client'
import type { Currency, ExpenseFormInputValues } from '@spliit/domain'
import { utcTodayIso } from '@spliit/domain'

export function useExpenseCurrencyConversion(args: {
  form: UseFormReturn<ExpenseFormInputValues>
  group: Group
  groupCurrency: Currency
}): {
  originalCurrency: Currency
  originalCurrencies: ReturnType<typeof useCurrencies>
  conversionRequired: boolean
  usingCustomConversionRate: boolean
  setUsingCustomConversionRate: Dispatch<SetStateAction<boolean>>
  conversionRateMessage: string
  exchangeRate: ReturnType<typeof useCurrencyRate>
  /**
   * Whether the typed amount is negative (income rather than expense). Derived
   * directly from the watched `amount` field; the parent can react to it
   * without a callback prop.
   */
  isIncome: boolean
  /**
   * Read-only preview of the typed `amount` after conversion into the group
   * (Ledger) currency. Undefined when no conversion is needed or the rate is
   * not yet known. Form state is never mutated from this value — it is purely
   * for display.
   */
  convertedAmountPreview: number | undefined
  /** Group ledger currency code to pin first in the expense selector. */
  pinnedCurrencyCode: string | undefined
  /**
   * Ranked recommendation codes once the query succeeds. `undefined` while
   * loading/on error so the selector keeps its static fallback.
   */
  recommendedCurrencyCodes: string[] | undefined
} {
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseForm' })
  const watchedExpenseDay = useWatch({
    control: args.form.control,
    name: 'expenseDay',
  })
  const watchedOriginalCurrency = useWatch({
    control: args.form.control,
    name: 'originalCurrency',
  })
  // The single editable amount is in the selected expense currency.
  const watchedAmount = useWatch({
    control: args.form.control,
    name: 'amount',
  })
  const watchedConversionRate = useWatch({
    control: args.form.control,
    name: 'conversionRate',
  })

  const originalCurrencyCode = args.form.getValues('originalCurrency')
  const originalCurrency = originalCurrencyCode
    ? (getCurrency(originalCurrencyCode) ?? {
        code: '',
        symbol: 'Custom',
        rounding: 0,
        decimal_digits: 2,
      })
    : { code: '', symbol: 'Custom', rounding: 0, decimal_digits: 2 }
  const originalCurrencies = useCurrencies('')
  const exchangeRate = useCurrencyRate(
    new Date(`${watchedExpenseDay}T00:00:00.000Z`),
    watchedOriginalCurrency ?? '',
    args.groupCurrency.code,
  )

  const commonCurrenciesQuery = trpc.groups.expenses.commonCurrencies.useQuery({
    groupId: args.group.id,
  })
  const pinnedCurrencyCode = args.group.currencyCode || undefined
  // Only swap the static common list after a successful response.
  const recommendedCurrencyCodes = commonCurrenciesQuery.isSuccess
    ? commonCurrenciesQuery.data.currencies
    : undefined

  const conversionRequired = !!(
    args.group.currencyCode &&
    args.group.currencyCode.length &&
    originalCurrency.code.length &&
    originalCurrency.code !== args.group.currencyCode
  )

  // Prefer conversionType over a bare rate: both EXCHANGE and CUSTOM
  // store a rate, so `!!conversionRate` alone always opens the custom UI.
  const initialType = args.form.formState.defaultValues?.conversionType ?? null
  const [usingCustomConversionRate, setUsingCustomConversionRate] = useState(
    () => {
      if (initialType === 'EXCHANGE') return false
      if (initialType === 'CUSTOM') return true
      // Missing / legacy: a stored rate means the custom path.
      return !!args.form.formState.defaultValues?.conversionRate
    },
  )

  useEffect(() => {
    if (!conversionRequired) {
      args.form.setValue('conversionType', undefined)
      return
    }
    if (usingCustomConversionRate) {
      args.form.setValue('conversionType', 'CUSTOM')
      return
    }
    // Keep EXCHANGE intent while the preview rate is loading so a save
    // before the fetch completes still persists the exchange source.
    args.form.setValue('conversionType', 'EXCHANGE')
    if (exchangeRate.data) {
      args.form.setValue('conversionRate', exchangeRate.data)
    }
  }, [
    conversionRequired,
    exchangeRate.data,
    usingCustomConversionRate,
    args.form,
  ])

  // Income detection: a negative typed amount flips the expense to income.
  // Derive directly from form state rather than passing the value back
  // to the parent via a callback in an effect.
  const isIncome = Number(watchedAmount) < 0

  // Derive the converted Ledger amount as a non-stored preview. Form
  // state stays untouched so the schema's `amount` invariant (which is
  // the user input) remains the single source of truth.
  const convertedAmountPreview = (() => {
    if (!conversionRequired) return undefined
    const amount = Number(watchedAmount) || 0
    const rateSource =
      usingCustomConversionRate && watchedConversionRate
        ? Number(watchedConversionRate)
        : exchangeRate.data
    if (!rateSource || Number.isNaN(rateSource) || rateSource <= 0) {
      return undefined
    }
    const converted = amount * rateSource
    return Number.isNaN(converted) ? undefined : converted
  })()

  const isFutureExpenseDate =
    watchedExpenseDay.length > 0 && watchedExpenseDay > utcTodayIso()

  let conversionRateMessage: string
  if (exchangeRate.isLoading) {
    conversionRateMessage = t('conversionRateState.loading')
  } else {
    let ratesDisplay = ''
    if (exchangeRate.data) {
      ratesDisplay = `${args.form.getValues('originalCurrency')}\xa01\xa0=\x20${
        args.group.currencyCode
      }\xa0${exchangeRate.data}`
    }
    const parts: string[] = []
    // Future expense dates always use today's rate (shared client/server rule).
    if (isFutureExpenseDate) {
      parts.push(t('conversionRateField.futureDateUsesToday'))
    }
    if (exchangeRate.error) {
      if (exchangeRate.error instanceof RangeError && exchangeRate.data) {
        parts.push(
          t('conversionRateState.dateMismatch', {
            date: exchangeRate.error.message,
          }),
        )
      } else {
        parts.push(t('conversionRateState.error'))
      }
      parts.push(
        ratesDisplay.length
          ? `${t('conversionRateState.staleRate')} ${ratesDisplay}`
          : t('conversionRateState.noRate'),
      )
    } else if (ratesDisplay.length) {
      parts.push(`${t('conversionRateState.success')} ${ratesDisplay}`)
    } else if (!isFutureExpenseDate) {
      parts.push(t('conversionRateState.currencyNotFound'))
    }
    conversionRateMessage = parts.join(' ')
  }

  return {
    originalCurrency,
    originalCurrencies,
    conversionRequired,
    usingCustomConversionRate,
    setUsingCustomConversionRate,
    conversionRateMessage,
    exchangeRate,
    isIncome,
    convertedAmountPreview,
    pinnedCurrencyCode,
    recommendedCurrencyCodes,
  }
}

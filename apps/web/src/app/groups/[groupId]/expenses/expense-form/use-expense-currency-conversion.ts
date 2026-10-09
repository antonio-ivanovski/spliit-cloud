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

import { useGroupAccessSearch } from '../../use-group-access-search'

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
  usingExactAmount: boolean
  setUsingExactAmount: Dispatch<SetStateAction<boolean>>
  impliedConversionRate: number | undefined
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
  const watchedExactAmount = useWatch({
    control: args.form.control,
    name: 'exactAmount',
  })
  const watchedExpenseTime = useWatch({
    control: args.form.control,
    name: 'expenseTime',
  })
  const watchedExpenseTimeZone = useWatch({
    control: args.form.control,
    name: 'expenseTimeZone',
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
    ...useGroupAccessSearch(),
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

  // Prefer conversionType over a bare rate: every persisted conversion source
  // stores a rate, so `!!conversionRate` alone always opens the custom UI.
  const defaultValues = args.form.formState.defaultValues
  const initialType = defaultValues?.conversionType ?? null
  // Issue #155: an EXCHANGE edit keeps its stored rate while the currency +
  // date/time key is unchanged, matching the server preservation rule. The
  // live fetch only takes over once the user changes the conversion key.
  const storedExchangeRate = (() => {
    const raw = Number(defaultValues?.conversionRate)
    return Number.isFinite(raw) && raw > 0 ? raw : undefined
  })()
  const exchangeKeyUnchanged =
    initialType === 'EXCHANGE' &&
    storedExchangeRate != null &&
    (watchedOriginalCurrency ?? '') ===
      (defaultValues?.originalCurrency ?? '') &&
    watchedExpenseDay === (defaultValues?.expenseDay ?? '') &&
    watchedExpenseTime === (defaultValues?.expenseTime ?? '') &&
    watchedExpenseTimeZone === (defaultValues?.expenseTimeZone ?? '')
  const preserveStoredRate = exchangeKeyUnchanged
  const effectiveExchangeRate = preserveStoredRate
    ? storedExchangeRate
    : exchangeRate.data
  const [usingCustomConversionRate, setUsingCustomConversionRate] = useState(
    () => {
      if (initialType === 'EXCHANGE') return false
      if (initialType === 'CUSTOM') return true
      if (initialType === 'EXACT') return false
      // Missing / legacy: a stored rate means the custom path.
      return !!args.form.formState.defaultValues?.conversionRate
    },
  )
  const [usingExactAmount, setUsingExactAmount] = useState(
    () => initialType === 'EXACT',
  )

  useEffect(() => {
    if (!conversionRequired) {
      args.form.setValue('conversionType', undefined)
      return
    }
    if (usingExactAmount) {
      args.form.setValue('conversionType', 'EXACT')
      return
    }
    if (usingCustomConversionRate) {
      args.form.setValue('conversionType', 'CUSTOM')
      return
    }
    // Keep EXCHANGE intent while the preview rate is loading so a save
    // before the fetch completes still persists the exchange source.
    args.form.setValue('conversionType', 'EXCHANGE')
    // Issue #155: don't clobber the stored EXCHANGE rate with a fresh fetch
    // while the conversion key is unchanged. A fresh rate only applies after
    // the user changes currency or date/time (server re-fetches then too).
    if (preserveStoredRate) {
      if (
        storedExchangeRate != null &&
        Number(args.form.getValues('conversionRate')) !== storedExchangeRate
      ) {
        args.form.setValue('conversionRate', storedExchangeRate)
      }
      return
    }
    if (exchangeRate.data) {
      args.form.setValue('conversionRate', exchangeRate.data)
    }
  }, [
    conversionRequired,
    exchangeRate.data,
    preserveStoredRate,
    storedExchangeRate,
    usingCustomConversionRate,
    usingExactAmount,
    args.form,
  ])

  // Income detection: a negative typed amount flips the expense to income.
  // Derive directly from form state rather than passing the value back
  // to the parent via a callback in an effect.
  const isIncome = Number(watchedAmount) < 0

  // Derive the converted Ledger amount as a non-stored preview. Form
  // state stays untouched so the schema's `amount` invariant (which is
  // the user input) remains the single source of truth.
  // Issue #155: while the conversion key is unchanged, preview with the
  // stored rate so the preview matches what the server will persist.
  const convertedAmountPreview = (() => {
    if (!conversionRequired) return undefined
    if (usingExactAmount) {
      const exact = Number(watchedExactAmount)
      return exact && Number.isFinite(exact) ? exact : undefined
    }
    const amount = Number(watchedAmount) || 0
    const rateSource =
      usingCustomConversionRate && watchedConversionRate
        ? Number(watchedConversionRate)
        : effectiveExchangeRate
    if (!rateSource || Number.isNaN(rateSource) || rateSource <= 0) {
      return undefined
    }
    const converted = amount * rateSource
    return Number.isNaN(converted) ? undefined : converted
  })()

  const impliedConversionRate = (() => {
    if (!usingExactAmount) return undefined
    const original = Number(watchedAmount)
    const exact = Number(watchedExactAmount)
    if (!original || !exact || Math.sign(original) !== Math.sign(exact)) {
      return undefined
    }
    return exact / original
  })()

  const isFutureExpenseDate =
    watchedExpenseDay.length > 0 && watchedExpenseDay > utcTodayIso()

  let conversionRateMessage: string
  if (preserveStoredRate) {
    // Issue #155: the stored rate is authoritative while the key is
    // unchanged. Show it directly so the message matches the preview and
    // the persisted total, regardless of the background live fetch.
    const ratesDisplay =
      storedExchangeRate != null
        ? `${args.form.getValues('originalCurrency')}\xa01\xa0=\x20${args.group.currencyCode}\xa0${storedExchangeRate}`
        : ''
    const parts: string[] = []
    if (isFutureExpenseDate) {
      parts.push(t('conversionRateField.futureDateUsesToday'))
    }
    if (ratesDisplay.length) {
      parts.push(`${t('conversionRateState.success')} ${ratesDisplay}`)
    } else if (!isFutureExpenseDate) {
      parts.push(t('conversionRateState.currencyNotFound'))
    }
    conversionRateMessage = parts.join(' ')
  } else if (exchangeRate.isLoading) {
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
    usingExactAmount,
    setUsingExactAmount,
    impliedConversionRate,
    conversionRateMessage,
    exchangeRate,
    isIncome,
    convertedAmountPreview,
    pinnedCurrencyCode,
    recommendedCurrencyCodes,
  }
}

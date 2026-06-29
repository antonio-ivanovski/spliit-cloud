import type { Group } from '@/lib/api'
import { getCurrency, useCurrencies } from '@/lib/currency'
import { useCurrencyRate } from '@/lib/hooks'
import type { Currency, ExpenseFormValues } from '@spliit/domain'
import type { Dispatch, SetStateAction } from 'react'
import { useEffect, useState } from 'react'
import type { UseFormReturn } from 'react-hook-form'
import { useWatch } from 'react-hook-form'

const enforceCurrencyPattern = (value: string) =>
  value
    .replace(/^\s*-/, '_') // replace leading minus with _
    .replace(/[.,]/, '#') // replace first comma with #
    .replace(/[-.,]/g, '') // remove other minus and commas characters
    .replace(/_/, '-') // change back _ to minus
    .replace(/#/, '.') // change back # to dot
    .replace(/[^-\d.]/g, '') // remove all non-numeric characters

export function useExpenseCurrencyConversion(args: {
  form: UseFormReturn<ExpenseFormValues, any, ExpenseFormValues>
  group: Group
  groupCurrency: Currency
  t: (key: string, opts?: Record<string, unknown>) => string
  onAmountChanged?: (income: boolean) => void
}): {
  originalCurrency: Currency
  originalCurrencies: ReturnType<typeof useCurrencies>
  conversionRequired: boolean
  usingCustomConversionRate: boolean
  setUsingCustomConversionRate: Dispatch<SetStateAction<boolean>>
  conversionRateMessage: string
  exchangeRate: ReturnType<typeof useCurrencyRate>
} {
  const watchedExpenseDate = useWatch({
    control: args.form.control,
    name: 'expenseDate',
  })
  const watchedOriginalCurrency = useWatch({
    control: args.form.control,
    name: 'originalCurrency',
  })
  const watchedOriginalAmount = useWatch({
    control: args.form.control,
    name: 'originalAmount',
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
    watchedExpenseDate,
    watchedOriginalCurrency ?? '',
    args.groupCurrency.code,
  )

  const conversionRequired = !!(
    args.group.currencyCode &&
    args.group.currencyCode.length &&
    originalCurrency.code.length &&
    originalCurrency.code !== args.group.currencyCode
  )

  const [usingCustomConversionRate, setUsingCustomConversionRate] = useState(
    !!args.form.formState.defaultValues?.conversionRate,
  )

  useEffect(() => {
    if (!usingCustomConversionRate && exchangeRate.data) {
      args.form.setValue('conversionRate', exchangeRate.data)
    }
  }, [exchangeRate.data, usingCustomConversionRate])

  useEffect(() => {
    if (!args.form.getFieldState('originalAmount').isTouched) return
    const originalAmount = args.form.getValues('originalAmount') ?? 0
    const conversionRate = args.form.getValues('conversionRate')

    if (conversionRate && originalAmount) {
      const rate = Number(conversionRate)
      const convertedAmount = originalAmount * rate
      if (!Number.isNaN(convertedAmount)) {
        const v = enforceCurrencyPattern(
          convertedAmount.toFixed(args.groupCurrency.decimal_digits),
        )
        args.onAmountChanged?.(Number(v) < 0)
        args.form.setValue('amount', Number(v))
      }
    }
  }, [
    watchedOriginalAmount,
    watchedConversionRate,
    args.form.getFieldState('originalAmount').isTouched,
  ])

  let conversionRateMessage = ''
  if (exchangeRate.isLoading) {
    conversionRateMessage = args.t('conversionRateState.loading')
  } else {
    let ratesDisplay = ''
    if (exchangeRate.data) {
      ratesDisplay = `${args.form.getValues('originalCurrency')}\xa01\xa0=\x20${
        args.group.currencyCode
      }\xa0${exchangeRate.data}`
    }
    if (exchangeRate.error) {
      if (exchangeRate.error instanceof RangeError && exchangeRate.data)
        conversionRateMessage = args.t('conversionRateState.dateMismatch', {
          date: exchangeRate.error.message,
        })
      else {
        conversionRateMessage = args.t('conversionRateState.error')
      }
      conversionRateMessage +=
        ' ' +
        (ratesDisplay.length
          ? `${args.t('conversionRateState.staleRate')} ${ratesDisplay}`
          : args.t('conversionRateState.noRate'))
    } else {
      conversionRateMessage = ratesDisplay.length
        ? `${args.t('conversionRateState.success')} ${ratesDisplay}`
        : args.t('conversionRateState.currencyNotFound')
    }
  }

  return {
    originalCurrency,
    originalCurrencies,
    conversionRequired,
    usingCustomConversionRate,
    setUsingCustomConversionRate,
    conversionRateMessage,
    exchangeRate,
  }
}

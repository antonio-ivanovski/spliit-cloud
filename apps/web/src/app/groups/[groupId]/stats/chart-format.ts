import type { Currency } from '@/lib/currency'
import { amountAsDecimal } from '@/lib/utils'
import { resolveFormattingLocale } from '@spliit/domain'

const compactNumberFormatCache = new Map<string, Intl.NumberFormat>()
const currencyNumberFormatCache = new Map<string, Intl.NumberFormat>()

function getCompactNumberFormat(locale: string) {
  let fmt = compactNumberFormatCache.get(locale)
  if (!fmt) {
    fmt = new Intl.NumberFormat(resolveFormattingLocale(locale), {
      notation: 'compact',
      maximumFractionDigits: 1,
    })
    compactNumberFormatCache.set(locale, fmt)
  }
  return fmt
}

function getCurrencyNumberFormat(locale: string, currencyCode: string) {
  const key = `${locale}:${currencyCode}`
  let fmt = currencyNumberFormatCache.get(key)
  if (!fmt) {
    fmt = new Intl.NumberFormat(resolveFormattingLocale(locale), {
      style: 'currency',
      currency: currencyCode,
      notation: 'compact',
      maximumFractionDigits: 1,
    })
    currencyNumberFormatCache.set(key, fmt)
  }
  return fmt
}

export function formatCompactCurrency(
  currency: Currency,
  amount: number,
  locale: string,
) {
  const value = amountAsDecimal(amount, currency)
  const numberFormat = getCompactNumberFormat(locale)

  if (!currency.code) return `${numberFormat.format(value)} ${currency.symbol}`

  return getCurrencyNumberFormat(locale, currency.code).format(value)
}

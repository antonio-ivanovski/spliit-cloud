import { getCurrency, type Currency } from '@/lib/currency'

export type CurrencyBalance = {
  currencyCode: string
  currency: Currency
  balances: Record<string, { paid: number; paidFor: number; total: number }>
  reimbursements: Array<{ from: string; to: string; amount: number }>
}

export function withDisplayCurrencies(
  summaries: Array<Omit<CurrencyBalance, 'currency'>>,
  groupCurrency: Currency,
): CurrencyBalance[] {
  return [...summaries]
    .sort((left, right) => {
      if (left.currencyCode === groupCurrency.code) return -1
      if (right.currencyCode === groupCurrency.code) return 1
      return left.currencyCode.localeCompare(right.currencyCode)
    })
    .map((summary) => ({
      ...summary,
      currency: resolveCurrency(summary.currencyCode, groupCurrency),
    }))
}

function resolveCurrency(
  currencyCode: string,
  groupCurrency: Currency,
): Currency {
  if (!currencyCode) return groupCurrency
  return (
    getCurrency(currencyCode) ?? {
      code: currencyCode,
      symbol: currencyCode,
      rounding: 0,
      decimal_digits: 2,
    }
  )
}

import currencies from './currencies.json' with { type: 'json' }

/**
 * Canonical currency record. Locale-specific display (name) is resolved by
 * the web app via i18n; the domain stays free of translation concerns.
 */
export type Currency = {
  code: string
  symbol: string
  rounding: number
  decimal_digits: number
}

/** All supported currencies, ordered by ISO code. */
export const currencyList: ReadonlyArray<Currency> = currencies

/**
 * ISO codes of every supported currency, inferred from the canonical
 * `currencies.json`. Add or remove a row in the JSON to update both the
 * runtime list and the compile-time union below.
 */
export const supportedCurrencyCodes = currencyList.map(
  (c) => c.code,
) as ReadonlyArray<(typeof currencyList)[number]['code']>
export type SupportedCurrencyCode = (typeof supportedCurrencyCodes)[number]

const byCode = new Map<string, Currency>(currencyList.map((c) => [c.code, c]))

/** Look up a currency by its ISO code. Returns undefined for unknown codes. */
export function getCurrency(code: string): Currency | undefined {
  return byCode.get(code)
}

/**
 * Resolve a group's stored currency into a canonical `Currency` record. For
 * a known `currencyCode` the canonical entry is returned; for a custom
 * currency (`currencyCode` empty) a synthetic record is built whose `symbol`
 * is the free-text `currency` value the user typed, so it can be displayed
 * verbatim. The returned record intentionally has no localized `name` — the
 * web app is responsible for adding one (or for the custom case, leaving
 * `symbol` as the user-visible label).
 */
export function getCurrencyFromGroup(group: {
  currency: string
  currencyCode?: string | null
}): Currency {
  if (!group.currencyCode) {
    return {
      code: '',
      symbol: group.currency,
      rounding: 0,
      decimal_digits: 2,
    }
  }
  return (
    byCode.get(group.currencyCode) ?? {
      code: group.currencyCode,
      symbol: group.currency,
      rounding: 0,
      decimal_digits: 2,
    }
  )
}

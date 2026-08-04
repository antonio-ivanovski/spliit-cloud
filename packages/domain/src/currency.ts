import currencies from './currencies.json' with { type: 'json' }

/**
 * Canonical currency record. Locale-specific display (name) is resolved by the
 * web app via i18n; the domain stays free of translation concerns.
 */
export type Currency = {
  code: string
  symbol: string
  aliases?: ReadonlyArray<string>
  rounding: number
  decimal_digits: number
  /**
   * Crypto assets (BTC, ETH, ...) vs fiat ISO currencies. Crypto assets trade
   * 24/7 and are quoted by the crypto rate provider instead of Frankfurter.
   */
  crypto?: boolean
  /**
   * Optional override for ordered bridge currencies when no direct crypto rate
   * exists. Absent entries use `DEFAULT_INTERMEDIARY_CURRENCIES` (`EUR`,
   * `USD`).
   */
  intermediaries?: ReadonlyArray<string>
  /**
   * Scale alias: one unit of this code equals `aliasScale` units of `aliasOf`
   * (e.g. 1 SAT = 1e-8 BTC). Rate lookups resolve through the parent code.
   */
  aliasOf?: string
  aliasScale?: number
}

/** Default bridge order when composing rates through an intermediary. */
export const DEFAULT_INTERMEDIARY_CURRENCIES = ['EUR', 'USD'] as const

/** True when `code` is a supported crypto asset (e.g. BTC, ETH, SAT). */
export function isCryptoCurrency(code: string): boolean {
  return byCode.get(code)?.crypto === true
}

/**
 * Ordered bridge currencies for `code`: the entry's explicit list when present,
 * otherwise `DEFAULT_INTERMEDIARY_CURRENCIES`.
 */
export function intermediaryCurrenciesFor(code: string): readonly string[] {
  return getCurrency(code)?.intermediaries ?? DEFAULT_INTERMEDIARY_CURRENCIES
}

/** All supported currencies, ordered by ISO code. */
export const currencyList: ReadonlyArray<Currency> = currencies

/**
 * ISO codes of every supported currency, inferred from the canonical
 * `currencies.json`. Add or remove a row in the JSON to update both the runtime
 * list and the compile-time union below.
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

/** Best-effort resolution of imported currency text to a supported ISO code. */
export function resolveCurrencyCode(value: string): string | null {
  const normalized = value.trim()
  if (!normalized) return null

  const byTextCode = byCode.get(normalized.toUpperCase())
  if (byTextCode) return byTextCode.code

  const normalizedText = normalized.toLowerCase()
  const matches = currencyList.filter(
    (currency) =>
      currency.symbol.toLowerCase() === normalizedText ||
      currency.aliases?.some((alias) => alias.toLowerCase() === normalizedText),
  )
  return matches.length === 1 ? matches[0]!.code : null
}

/**
 * Resolve a group's stored currency into a canonical `Currency` record. For a
 * known `currencyCode` the canonical entry is returned; for a custom currency
 * (`currencyCode` empty) a synthetic record is built whose `symbol` is the
 * free-text `currency` value the user typed, so it can be displayed verbatim.
 * The returned record intentionally has no localized `name` — the web app is
 * responsible for adding one (or for the custom case, leaving `symbol` as the
 * user-visible label).
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

/**
 * Display metadata for FX providers returned by the currency rates API. URLs
 * point at each provider's public API / docs so users can verify sources.
 */
export const CURRENCY_RATE_PROVIDERS = {
  frankfurter: {
    id: 'frankfurter',
    /** Public Frankfurter docs / API landing page. */
    url: 'https://frankfurter.dev/',
  },
  coinbase: {
    id: 'coinbase',
    /** Coinbase App API — spot price endpoint used for crypto quotes. */
    url: 'https://docs.cdp.coinbase.com/coinbase-app/track-apis/prices#get-spot-price',
  },
} as const

export type CurrencyRateProviderId = keyof typeof CURRENCY_RATE_PROVIDERS

export type CurrencyRateSource = {
  provider: CurrencyRateProviderId
  base: string
  target: string
}

export function isCurrencyRateProviderId(
  value: string,
): value is CurrencyRateProviderId {
  return value in CURRENCY_RATE_PROVIDERS
}

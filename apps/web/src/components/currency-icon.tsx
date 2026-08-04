import btc from '@/assets/cryptocurrencies/btc.svg'
import doge from '@/assets/cryptocurrencies/doge.svg'
import eth from '@/assets/cryptocurrencies/eth.svg'
import ltc from '@/assets/cryptocurrencies/ltc.svg'
import sol from '@/assets/cryptocurrencies/sol.svg'
import xrp from '@/assets/cryptocurrencies/xrp.svg'

/** Bundled SVG icon per crypto code; sats reuse the Bitcoin icon. */
const CRYPTO_ICONS: Record<string, string> = {
  BTC: btc,
  DOGE: doge,
  ETH: eth,
  LTC: ltc,
  SAT: btc,
  SOL: sol,
  XRP: xrp,
}

/** Crypto icon source for `code`, or null for fiat/custom currencies. */
export function currencyIconSrc(code: string): string | null {
  return CRYPTO_ICONS[code.toUpperCase()] ?? null
}

/**
 * Flag or crypto icon for a currency code. Fiat currencies use the flagcdn
 * country flag derived from the code's first two letters; crypto assets use
 * bundled SVG icons (country flags would be wrong — BTC would render Bhutan's
 * flag). Returns null for unknown/custom codes so callers can render their own
 * fallback.
 */
export function CurrencyIcon({
  code,
  className,
}: {
  code: string
  className?: string
}) {
  const iconSrc = currencyIconSrc(code)
  if (iconSrc) {
    return <img src={iconSrc} className={className} alt="" aria-hidden="true" />
  }
  if (!code) return null
  const flagUrl = `https://flagcdn.com/h24/${code.slice(0, 2).toLowerCase()}.png`
  return <img src={flagUrl} className={className} alt="" aria-hidden="true" />
}

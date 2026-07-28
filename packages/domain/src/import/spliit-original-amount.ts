import { conversionMinorScale } from '../utils'

/**
 * Recover expense-currency minor units from a Spliit export ledger amount.
 *
 * Upstream Spliit often stores/exports a broken `originalAmount` that drops
 * fractional major units (e.g. typed 1.23 → stored/exported as 1). See:
 * https://github.com/spliit-app/spliit/issues/513
 *
 * Always recompute from the reliable ledger total using the major-unit FX rate
 * (and optional currency codes when decimal digits differ). No caching — pure
 * math, one call per expense at parse time only.
 */
export function recoverSpliitOriginalAmount(
  ledgerAmountMinor: number,
  conversionRate: number,
  currencies?: {
    originalCurrency?: string | null
    ledgerCurrency?: string | null
  },
): number {
  const scale = conversionMinorScale(
    conversionRate,
    currencies?.originalCurrency,
    currencies?.ledgerCurrency,
  )
  return Math.round(ledgerAmountMinor / scale)
}

/**
 * Whether this Spliit export row has the fields needed to recover original
 * money from ledger ÷ rate (original currency + positive conversion rate).
 *
 * Not a cache flag and not "already converted in a previous step" — just "this
 * row claims a non-ledger expense currency".
 */
export function shouldRecoverSpliitOriginal(args: {
  originalCurrency: string | null | undefined
  conversionRate: number | null | undefined
}): boolean {
  return (
    args.originalCurrency != null &&
    args.originalCurrency !== '' &&
    args.conversionRate != null &&
    Number.isFinite(args.conversionRate) &&
    args.conversionRate > 0
  )
}

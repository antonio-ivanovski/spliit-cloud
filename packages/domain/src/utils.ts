import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

import type { Category } from './categories'
import { getCurrency, getCurrencyFromGroup, type Currency } from './currency'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function randomId(size?: number) {
  const id = crypto.randomUUID().replaceAll('-', '')
  return size ? id.slice(0, size) : id
}

/**
 * Stable 32-bit seed from a string (FNV-1a). Used for remainder tie-break.
 * Returns unsigned 0..2^32-1 so `seed % n` is well-defined.
 */
export function hashStringToSeed(value: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    // FNV prime 16777619; keep as uint32
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

/**
 * Remainder-distribution seed from expense id; 0 when id is missing
 * (create/preview).
 */
export function expenseIdSeed(expenseId: string | null | undefined): number {
  if (expenseId == null || expenseId === '') return 0
  return hashStringToSeed(expenseId)
}

export function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export type DateTimeStyle = NonNullable<
  ConstructorParameters<typeof Intl.DateTimeFormat>[1]
>['dateStyle']
export function formatDate(
  date: Date,
  locale: string,
  options: { dateStyle?: DateTimeStyle; timeStyle?: DateTimeStyle } = {},
) {
  return date.toLocaleString(locale, {
    ...options,
  })
}

/**
 * Formats a date-only field (without time) for display. Extracts UTC date
 * components to avoid timezone shifts that can cause off-by-one day errors. Use
 * this for dates stored as DATE type in the database (e.g., expenseDate).
 *
 * @param date - The date to format (typically from a database DATE field, e.g.,
 *   2025-10-17T00:00:00.000Z)
 * @param locale - The locale string (e.g., 'en-US', 'fr-FR')
 * @param options - Formatting options (dateStyle, timeStyle)
 * @returns Formatted date string in the specified locale
 */
export function formatDateOnly(
  date: Date,
  locale: string,
  options: { dateStyle?: DateTimeStyle; timeStyle?: DateTimeStyle } = {},
) {
  // Extract UTC date components to avoid timezone shifts
  const year = date.getUTCFullYear()
  const month = date.getUTCMonth()
  const day = date.getUTCDate()

  // Create a new date in the user's local timezone with these components
  const localDate = new Date(year, month, day)

  return localDate.toLocaleString(locale, {
    ...options,
  })
}

export function formatCategoryForAIPrompt(
  category: Pick<Category, 'id' | 'grouping' | 'name'>,
) {
  return `"${category.grouping}/${category.name}" (ID: ${category.id})`
}

/**
 * @param fractions Financial values in this app are generally processed in
 *   cents (or equivalent). They are are therefore integer representations of
 *   the amount (e.g. 100 for USD 1.00). Set this to `true` if you need to pass
 *   a value with decimal fractions instead (e.g. 1.00 for USD 1.00).
 */
export function formatCurrency(
  currency: Currency,
  amount: number,
  locale: string,
  fractions?: boolean,
) {
  const format = new Intl.NumberFormat(locale, {
    minimumFractionDigits: currency.decimal_digits,
    maximumFractionDigits: currency.decimal_digits,
    style: 'currency',
    // '€' will be placed in correct position
    currency: currency.code.length ? currency.code : 'EUR',
  })
  const formatted = format.format(
    fractions ? amount : amountAsDecimal(amount, currency),
  )
  if (currency.code.length) {
    return formatted
  }
  return formatted.replace('€', currency.symbol)
}

export { getCurrencyFromGroup }

/**
 * Converts monetary amounts in minor units to the corresponding amount in major
 * units in the given currency. e.g. - 150 "minor units" of euros = 1.5 - 1000
 * "minor units" of yen = 1000 (the yen does not have minor units in practice)
 *
 * @param amount The amount, as the number of minor units of currency (cents for
 *   most currencies)
 * @param round Whether to round the amount to the nearest minor unit (e.g.:
 *   1.5612 € => 1.56 €)
 */
export function amountAsDecimal(
  amount: number,
  currency: Currency,
  round = false,
) {
  const decimal = amount / 10 ** currency.decimal_digits
  if (round) {
    return Number(decimal.toFixed(currency.decimal_digits))
  }
  return decimal
}

/**
 * Converts decimal monetary amounts in major units to the amount in minor units
 * in the given currency. e.g. - €1.5 = 150 "minor units" of euros (cents) - JPY
 * 1000 = 1000 "minor units" of yen (the yen does not have minor units in
 * practice)
 *
 * @param amount The amount in decimal major units (always an integer)
 */
export function amountAsMinorUnits(amount: number, currency: Currency) {
  return Math.round(amount * 10 ** currency.decimal_digits)
}

/**
 * Converts a decimal major-unit amount to minor units using the currency's
 * decimal digits, resolved from an ISO 4217 code. Unknown codes fall back to 2
 * decimal digits (preserving the legacy behaviour).
 */
export function amountAsMinorUnitsByCode(amount: number, currencyCode: string) {
  const c = getCurrency(currencyCode) ?? {
    code: currencyCode,
    symbol: currencyCode,
    rounding: 0,
    decimal_digits: 2,
  }
  return amountAsMinorUnits(amount, c)
}

function decimalDigitsForCode(code: string | null | undefined): number {
  if (!code) return 2
  return getCurrency(code)?.decimal_digits ?? 2
}

/**
 * Scale factor that converts source-currency minor units to target-currency
 * minor units for a major-unit FX rate (1 source major = `rate` target major).
 *
 * When currencies share the same `decimal_digits` this equals `rate`. When they
 * differ (e.g. USD→JPY), it adjusts so $100 (10000¢) at 150 JPY/USD becomes
 * 15_000 yen, not 1_500_000.
 */
export function conversionMinorScale(
  rate: number,
  fromCurrencyCode: string | null | undefined,
  toCurrencyCode: string | null | undefined,
): number {
  const fromDigits = decimalDigitsForCode(fromCurrencyCode)
  const toDigits = decimalDigitsForCode(toCurrencyCode)
  return rate * 10 ** (toDigits - fromDigits)
}

/**
 * Apply a major-unit FX rate to an amount in source minor units, producing
 * target minor units (rounded to nearest integer).
 */
export function convertMinorUnitsByRate(
  amountMinor: number,
  rate: number,
  fromCurrencyCode: string | null | undefined,
  toCurrencyCode: string | null | undefined,
): number {
  return Math.round(
    amountMinor * conversionMinorScale(rate, fromCurrencyCode, toCurrencyCode),
  )
}

/**
 * Formats monetary amounts in minor units to the corresponding amount in major
 * units in the given currency, as a string, with correct rounding.
 *
 * @param amount The amount, as the number of minor units of currency (cents for
 *   most currencies)
 */
export function formatAmountAsDecimal(amount: number, currency: Currency) {
  return amountAsDecimal(amount, currency).toFixed(currency.decimal_digits)
}

export function formatFileSize(size: number, locale: string) {
  const formatNumber = (num: number) =>
    num.toLocaleString(locale, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 1,
    })

  if (size > 1024 ** 3) return `${formatNumber(size / 1024 ** 3)} GB`
  if (size > 1024 ** 2) return `${formatNumber(size / 1024 ** 2)} MB`
  if (size > 1024) return `${formatNumber(size / 1024)} kB`
  return `${formatNumber(size)} B`
}

export function normalizeString(input: string): string {
  // Replaces special characters
  // Input: áäåèéę
  // Output: aaaeee
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

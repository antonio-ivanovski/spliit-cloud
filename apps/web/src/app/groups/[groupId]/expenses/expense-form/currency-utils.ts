import {
  amountPlaceholder,
  enforceCurrencyPattern as baseEnforceCurrencyPattern,
  stripIntegerLeadingZeros,
} from '@/lib/currency-input'
import { MAX_DISPLAY_SHARES, sharesAsFixedUnits } from '@spliit/domain'

export { amountPlaceholder }

/**
 * Expense-form currency sanitizer: the shared `enforceCurrencyPattern` plus
 * leading-zero canonicalization ("00.50" -> "0.50", "0004" -> "4") so expense
 * inputs never display zero-padded values. The canonicalization is deliberately
 * local: rewriting a padded value moves the caret mid-edit, and budgets / the
 * currency converter must not inherit that behavior from an expense-form
 * concern.
 */
export const enforceCurrencyPattern = (
  value: string,
  decimalDigits?: number,
): string =>
  stripIntegerLeadingZeros(baseEnforceCurrencyPattern(value, decimalDigits))

type PasteCurrency = { code: string; symbol: string }

export type ParsedCurrencyPaste = {
  amount: string
  currencyCode?: string
}

const DEFAULT_CURRENCY_BY_SYMBOL: Record<string, string> = {
  $: 'USD',
  '£': 'GBP',
  '€': 'EUR',
  '¥': 'JPY',
  '￥': 'JPY',
}

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Parse a pasted money value without changing the permissive typing path. */
export function parseCurrencyPaste(
  value: string,
  currencies: readonly PasteCurrency[],
): ParsedCurrencyPaste | null {
  const source = value.replace(/[\u00a0\u202f]/g, ' ').trim()
  if (!source) return null

  const available = currencies.filter((currency) => currency.code)
  const explicitCode = available.find((currency) =>
    new RegExp(`\\b${escapeRegExp(currency.code)}\\b`, 'i').test(source),
  )?.code

  const matchedSymbols = available.filter(
    (currency) => currency.symbol && source.includes(currency.symbol),
  )
  const symbols = [
    ...new Set(matchedSymbols.map((currency) => currency.symbol)),
  ]
  const symbol = symbols.length === 1 ? symbols[0] : undefined
  const currencyCode =
    explicitCode ??
    (symbol && matchedSymbols.length === 1
      ? matchedSymbols[0]?.code
      : undefined) ??
    (symbol &&
    available.some(
      (currency) => currency.code === DEFAULT_CURRENCY_BY_SYMBOL[symbol],
    )
      ? DEFAULT_CURRENCY_BY_SYMBOL[symbol]
      : undefined)

  let numeric = source
  for (const currency of available) {
    numeric = numeric.replace(
      new RegExp(`\\b${escapeRegExp(currency.code)}\\b`, 'gi'),
      '',
    )
    if (currency.symbol) {
      numeric = numeric.replace(
        new RegExp(escapeRegExp(currency.symbol), 'g'),
        '',
      )
    }
  }

  // Currency markers and a single numeric token are the only accepted text.
  if (/[A-Za-z]/.test(numeric)) return null
  const hasParentheses = /^\s*\(.*\)\s*$/.test(numeric)
  if (
    numeric.includes('(') !== numeric.includes(')') ||
    (numeric.includes('(') && !hasParentheses)
  ) {
    return null
  }
  numeric = numeric.replace(/[()]/g, '').replace(/\s+/g, '')
  numeric = numeric.replace(/[']/g, '')
  numeric = numeric.replace(/^[+-]/, '')
  if (!/^\d[\d.,]*$/.test(numeric)) return null

  const separators = [...numeric.matchAll(/[.,]/g)].map((match) => match.index!)
  const separatorChars = Array.from(numeric).filter(
    (char) => char === '.' || char === ',',
  )
  let integerPart = numeric
  let fractionPart = ''

  if (separatorChars.length > 0) {
    const distinct = new Set(separatorChars)
    const lastSeparatorIndex = Math.max(...separators)
    const lastSeparator = numeric[lastSeparatorIndex]
    const trailingDigits = numeric.length - lastSeparatorIndex - 1
    const repeatedGrouping =
      separatorChars.length > 1 &&
      separatorChars.length === separators.length &&
      separatorChars.every((_, index) => {
        const start = separators[index]! + 1
        const end = separators[index + 1] ?? numeric.length
        return end - start === 3
      }) &&
      trailingDigits === 3

    const decimalSeparator =
      distinct.size > 1
        ? lastSeparator
        : repeatedGrouping
          ? undefined
          : trailingDigits === 3
            ? undefined
            : lastSeparator

    if (decimalSeparator) {
      const decimalIndex = numeric.lastIndexOf(decimalSeparator)
      integerPart = numeric.slice(0, decimalIndex)
      fractionPart = numeric.slice(decimalIndex + 1)
    }
  }

  integerPart = integerPart.replace(/[.,]/g, '')
  if (
    !integerPart ||
    !/^\d+$/.test(integerPart) ||
    !/^\d*$/.test(fractionPart)
  ) {
    return null
  }
  const normalizedInteger = integerPart.replace(/^0+(?=\d)/, '')
  const amount = fractionPart
    ? `${normalizedInteger}.${fractionPart}`
    : normalizedInteger
  if (!Number.isFinite(Number(amount))) return null

  return { amount, ...(currencyCode ? { currencyCode } : {}) }
}

export const enforcePercentagePattern = (value: string) => {
  const sanitized = value
    .replace(/^\s*-/, '_')
    .replace(/[.,]/, '#')
    .replace(/[-.,]/g, '')
    .replace(/_/, '-')
    .replace(/#/, '.')
  const match = sanitized.match(/^(-?\d*)\.?(\d{0,2})/)
  if (!match) return ''
  const intPart = match[1] ?? ''
  const decPart = match[2] ?? ''
  return decPart
    ? `${stripIntegerLeadingZeros(intPart)}.${decPart}`
    : stripIntegerLeadingZeros(intPart)
}

export const enforceIntegerPattern = (value: string) =>
  value.replace(/[^\d]/g, '')

/**
 * Normalize the integer portion of a typed share: strip leading zeros while
 * retaining a single zero when the whole integer portion is zero (`04` -> `4`,
 * `00` -> `0`). Editing states such as `0.` or `0.10` survive because only the
 * integer digits are touched and the value never round-trips through
 * `Number()`. A leading minus sign is preserved (`-004` -> `-4`).
 */
const normalizeShareIntegerPart = (rawInteger: string): string => {
  const negative = rawInteger.startsWith('-')
  const digits = negative ? rawInteger.slice(1) : rawInteger
  const normalized = digits.replace(/^0+(?=\d)/, '')
  return negative ? `-${normalized}` : normalized
}

/**
 * Sanitize a typed share string to the `BY_SHARES` representation: an optional
 * minus sign, digits, and at most two decimal places. Unlike the currency
 * sanitizer, shares are user-facing whole/decimal numbers (e.g. `0.5`, `1.1`,
 * `25.75`) and always have at most two decimal places — there is no currency
 * precision to discover.
 *
 * Trailing-dot input (`"1."`) is preserved so the user can finish typing the
 * fractional part without losing focus.
 */
export const enforceSharePattern = (value: string) => {
  // Drop everything that isn't a digit, decimal separator, or leading sign.
  const stripped = value.replace(/[^0-9.,-]/g, '').replace(/(?!^)-/g, '')
  if (stripped === '' || stripped === '-') return stripped
  // Keep only the FIRST decimal separator as the decimal point; any
  // later separator is treated as extra fraction digits and truncated.
  const firstDot = stripped.indexOf('.')
  const firstComma = stripped.indexOf(',')
  const firstSeparator =
    firstDot === -1
      ? firstComma
      : firstComma === -1
        ? firstDot
        : Math.min(firstDot, firstComma)
  const integerPart =
    firstSeparator === -1 ? stripped : stripped.slice(0, firstSeparator)
  const fractionRaw =
    firstSeparator === -1 ? '' : stripped.slice(firstSeparator + 1)
  const fractionPart = fractionRaw.replace(/[.,]/g, '').slice(0, 2)
  const cleanedInt = normalizeShareIntegerPart(integerPart.replace(/[.,]/g, ''))
  if (fractionPart) {
    // Normalize a leading separator (`.5`) to `0.5` so the value stays
    // complete when the user typed it from an empty input.
    return cleanedInt ? `${cleanedInt}.${fractionPart}` : `0.${fractionPart}`
  }
  return firstSeparator === -1 ? cleanedInt : `${cleanedInt}.`
}

/**
 * Pure stepper boundary for `BY_SHARES` rows: the next display share for a
 * plus/minus button click. Whole values step by 1 (`2 +` yields `3`); any
 * fractional value steps by 0.1 regardless of magnitude (`0.5 +` yields `0.6`,
 * `1.5 +` yields `1.6`, `1.9 +` yields `2`, `1.5 -` yields `1.4`). The result
 * is rounded to two decimal places and clamped to the valid display range.
 * Callers decide what a zero result means for their row (removal).
 */
export function stepDisplayShares(value: unknown, direction: 1 | -1): number {
  const current = Number(value)
  const currentValue = Number.isFinite(current) ? current : 0
  const step = Number.isInteger(currentValue) ? 1 : 0.1
  const next = currentValue + direction * step
  const clamped = Math.min(Math.max(next, 0), MAX_DISPLAY_SHARES)
  return Math.round(clamped * 100) / 100
}

// Convert a Date to an ISO date string suitable for <input type="date" defaultValue>.
export function formatDate(date?: Date) {
  const validDate = date && !Number.isNaN(date.getTime()) ? date : new Date()
  return validDate.toISOString().substring(0, 10)
}

/**
 * Pure input-state helper for the `BY_SHARES` share editors (flat paid-for,
 * multi-payer paid-by, and the item/remainder participant modal).
 *
 * The sanitized string is kept in form/draft state — exactly like `BY_AMOUNT`
 * rows — so intermediate states such as `"0"`, `"0."`, `"1."`, or a
 * comma-decimal input survive the controlled-input round-trip while typing. A
 * row is only removed on an explicit empty string (or an explicit removal
 * interaction by callers, e.g. the checkbox or stepper). Numeric zero is an
 * invalid but visible intermediate value: it stays in the list and the schema
 * rejects it on submit.
 *
 * Consumers convert with `Number()` only at preview and serialization
 * boundaries, where incomplete values safely round-trip to zero.
 */
export function nextShareRowsFromInput<T extends { participant: string }>(
  rows: readonly T[],
  participantId: string,
  sanitized: string,
): T[] {
  const next = rows.filter((row) => row.participant !== participantId)
  // Preserve every non-empty sanitized string — including "0", "0.", and
  // "0.5" — so typing never makes the input vanish; the row disappears
  // only when the user clears the value.
  if (sanitized !== '') {
    next.push({
      participant: participantId,
      shares: sanitized,
    } as unknown as T)
  }
  return next
}

/**
 * Shared preview boundary: convert a display share (form state, may still be an
 * incomplete string like `"0."`) to stored fixed units. Invalid intermediate
 * states round-trip to 0 so the preview calculation stays in integer space; the
 * schema rejects anything that fails validation on submit.
 */
export function safeSharesToFixedUnits(value: unknown): number {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return 0
  try {
    return sharesAsFixedUnits(numeric)
  } catch {
    return 0
  }
}

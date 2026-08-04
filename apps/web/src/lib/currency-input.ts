/** Max fraction digits shown in amount placeholders (BTC may store 8). */
export const AMOUNT_PLACEHOLDER_MAX_DIGITS = 4

/**
 * Sanitize a user-typed currency string so users can type "1.234,56" or "-10"
 * and get a parseable value. When `decimalDigits` is set, truncate the
 * fractional part to that many digits (currency limit); omit to leave the
 * fraction unconstrained (e.g. free-form FX rate fields).
 */
export function enforceCurrencyPattern(
  value: string,
  decimalDigits?: number,
): string {
  const sanitized = value
    .replace(/^\s*-/, '_')
    .replace(/[.,]/, '#')
    .replace(/[-.,]/g, '')
    .replace(/_/, '-')
    .replace(/#/, '.')
    .replace(/[^-\d.]/g, '')

  if (decimalDigits === undefined) return sanitized
  if (decimalDigits <= 0) {
    const dot = sanitized.indexOf('.')
    return dot === -1 ? sanitized : sanitized.slice(0, dot)
  }
  const dot = sanitized.indexOf('.')
  if (dot === -1) return sanitized
  return sanitized.slice(0, dot + 1 + decimalDigits)
}

/** Placeholder like `0`, `0.00`, or `0.0000` (capped at 4 fractional digits). */
export function amountPlaceholder(decimalDigits: number): string {
  const digits = Math.min(
    Math.max(decimalDigits, 0),
    AMOUNT_PLACEHOLDER_MAX_DIGITS,
  )
  if (digits === 0) return '0'
  return `0.${'0'.repeat(digits)}`
}

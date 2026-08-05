/** Max fraction digits shown in amount placeholders (BTC may store 8). */
export const AMOUNT_PLACEHOLDER_MAX_DIGITS = 4

/**
 * Collapse leading zeros in the integer portion so amounts never display
 * zero-padded ("0004" -> "4", "0000" -> "0", "-004" -> "-4"). A single zero is
 * kept when the whole integer portion is zero ("0", "0.5", "00." -> "0."). A
 * leading minus sign is preserved.
 */
export function stripIntegerLeadingZeros(value: string): string {
  if (value === '' || value === '-') return value
  const negative = value.startsWith('-')
  const body = negative ? value.slice(1) : value
  const dot = body.indexOf('.')
  const integerPart = dot === -1 ? body : body.slice(0, dot)
  const normalized = integerPart.replace(/^0+(?=\d)/, '')
  return `${negative ? '-' : ''}${normalized}${dot === -1 ? '' : body.slice(dot)}`
}

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

  let result = sanitized
  if (decimalDigits !== undefined) {
    const dot = sanitized.indexOf('.')
    if (decimalDigits <= 0) {
      result = dot === -1 ? sanitized : sanitized.slice(0, dot)
    } else if (dot !== -1) {
      result = sanitized.slice(0, dot + 1 + decimalDigits)
    }
  }
  // Deliberately no leading-zero canonicalization here: rewriting a padded
  // value ("0004" -> "4") moves the caret mid-edit, and budgets / the
  // currency converter should not inherit that behavior from an
  // expense-form concern. The expense-form wrapper applies
  // `stripIntegerLeadingZeros` locally.
  return result
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

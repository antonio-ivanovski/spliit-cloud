import { locales, resolveFormattingLocale } from '@spliit/domain/i18n'

/** Max fraction digits shown in amount placeholders (BTC may store 8). */
export const AMOUNT_PLACEHOLDER_MAX_DIGITS = 4

const STATIC_DIGIT_MAP: Record<string, string> = Object.fromEntries([
  ...Array.from({ length: 10 }, (_, digit) => [String(digit), String(digit)]),
  ...Array.from({ length: 10 }, (_, digit) => [
    String.fromCharCode(0x660 + digit),
    String(digit),
  ]),
  ...Array.from({ length: 10 }, (_, digit) => [
    String.fromCharCode(0x6f0 + digit),
    String(digit),
  ]),
  ...Array.from({ length: 10 }, (_, digit) => [
    String.fromCharCode(0x966 + digit),
    String(digit),
  ]),
  ...Array.from({ length: 10 }, (_, digit) => [
    String.fromCharCode(0x9e6 + digit),
    String(digit),
  ]),
])

type LocaleNumberData = {
  decimal: string
  group: string
  minus: string
  digitMap: Map<string, string>
  localizedDigits: string[]
}

const LOCALE_NUMBER_DATA = new Map<(typeof locales)[number], LocaleNumberData>()
for (const locale of locales) {
  const formattingLocale = resolveFormattingLocale(locale)
  const formatter = new Intl.NumberFormat(formattingLocale, {
    useGrouping: false,
  })
  const parts = new Intl.NumberFormat(formattingLocale).formatToParts(-12345.6)
  const localeDigits = Array.from(formatter.format(9876543210)).filter(
    (character) => !/[\u200e\u200f\u061c]/u.test(character),
  )

  LOCALE_NUMBER_DATA.set(locale, {
    decimal: parts.find((part) => part.type === 'decimal')?.value ?? '.',
    group: parts.find((part) => part.type === 'group')?.value ?? ',',
    minus: parts.find((part) => part.type === 'minusSign')?.value ?? '-',
    digitMap: new Map(
      localeDigits.map((character, index) => [character, String(9 - index)]),
    ),
    localizedDigits: Array.from({ length: 10 }, (_, digit) =>
      formatter.format(digit),
    ),
  })
}

function localeNumberData(locale: string) {
  return (
    LOCALE_NUMBER_DATA.get(locale as (typeof locales)[number]) ??
    LOCALE_NUMBER_DATA.get('en-US')!
  )
}

function localeNumberParts(locale: string) {
  const { decimal, group, minus } = localeNumberData(locale)
  return { decimal, group, minus }
}

export function normalizeDigits(value: string, locale: string): string {
  const { digitMap } = localeNumberData(locale)
  return Array.from(value)
    .map(
      (character) =>
        digitMap.get(character) ?? STATIC_DIGIT_MAP[character] ?? character,
    )
    .join('')
}

/**
 * Convert a canonical ASCII editing value back to the active locale without
 * adding grouping or losing intermediate states such as `1.` or `-`.
 */
export function localizeCurrencyInput(value: string, locale: string): string {
  if (!value) return value
  const { decimal, minus, localizedDigits } = localeNumberData(locale)

  return Array.from(value)
    .map((character) => {
      if (/\d/.test(character)) return localizedDigits[Number(character)]
      if (character === '.') return decimal
      if (character === '-') return minus
      return character
    })
    .join('')
}

function isGroupingPattern(value: string, separator: string): boolean {
  const parts = value.split(separator)
  if (parts.length <= 1 || parts[0]!.length < 1 || parts[0]!.length > 3) {
    return false
  }
  if (parts.slice(1).every((part) => part.length === 3)) return true
  // Indian-style grouping uses two digits for the middle groups and three for
  // the final group (12,34,567). Accepting this shape keeps pasted amounts
  // tolerant without treating a single `12,34` decimal as grouping.
  return (
    parts.length >= 3 &&
    parts.at(-1)!.length === 3 &&
    parts.slice(1, -1).every((part) => part.length === 2)
  )
}

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
  locale = 'en-US',
): string {
  if (value === '') return ''

  const { decimal, group, minus } = localeNumberParts(locale)
  const localeDecimal = decimal === '٫' ? '.' : decimal
  const localeGroup = group === '٬' ? ',' : group
  const normalized = normalizeDigits(value, locale)
  const negative =
    normalized.trimStart().startsWith('-') ||
    normalized.trimStart().startsWith(minus)
  const body = normalized
    .replace(/^\s*[-−]/u, '')
    .replaceAll(minus, '')
    .replace(/[^\d.,٫٬'\u00a0\u202f\s]/gu, '')
    .replace(/[\u00a0\u202f\s']/gu, '')
    .replaceAll('٫', '.')
    .replaceAll('٬', ',')

  const separators = Array.from(body).filter(
    (character) => character === '.' || character === ',',
  )
  let integerPart = body
  let fractionPart = ''
  if (separators.length > 0) {
    const separatorSet = new Set(separators)
    const lastSeparator = separators.at(-1)!
    let decimalSeparator: string | undefined

    if (separatorSet.size > 1) {
      decimalSeparator = lastSeparator
    } else if (separators.length > 1) {
      decimalSeparator = isGroupingPattern(body, lastSeparator)
        ? undefined
        : lastSeparator
    } else if (lastSeparator === localeDecimal) {
      decimalSeparator = lastSeparator
    } else if (
      !isGroupingPattern(body, lastSeparator) ||
      decimalDigits === undefined ||
      lastSeparator !== localeGroup ||
      (decimalDigits !== undefined && decimalDigits > 2)
    ) {
      decimalSeparator = lastSeparator
    }

    if (decimalSeparator) {
      const decimalIndex = body.indexOf(decimalSeparator)
      integerPart = body.slice(0, decimalIndex)
      fractionPart = body.slice(decimalIndex + 1)
    }
  }

  integerPart = integerPart.replace(/[.,]/g, '')
  fractionPart = fractionPart.replace(/[.,]/g, '')
  let result = `${negative ? '-' : ''}${integerPart || ''}`
  if (fractionPart.length > 0 || separators.at(-1) === localeDecimal) {
    result += `.${fractionPart}`
  }
  if (decimalDigits !== undefined) {
    const dot = result.indexOf('.')
    if (decimalDigits <= 0) {
      result = dot === -1 ? result : result.slice(0, dot)
    } else if (dot !== -1) {
      result = result.slice(0, dot + 1 + decimalDigits)
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
export function amountPlaceholder(
  decimalDigits: number,
  locale = 'en-US',
): string {
  const digits = Math.min(
    Math.max(decimalDigits, 0),
    AMOUNT_PLACEHOLDER_MAX_DIGITS,
  )
  return new Intl.NumberFormat(resolveFormattingLocale(locale), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    useGrouping: false,
  }).format(0)
}

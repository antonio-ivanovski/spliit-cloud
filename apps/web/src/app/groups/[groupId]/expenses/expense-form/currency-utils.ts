// Sanitize a user-typed currency string so users can type "1.234,56" or "-10" and get a parseable value.
export const enforceCurrencyPattern = (value: string) =>
  value
    .replace(/^\s*-/, '_')
    .replace(/[.,]/, '#')
    .replace(/[-.,]/g, '')
    .replace(/_/, '-')
    .replace(/#/, '.')
    .replace(/[^-\d.]/g, '')

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
  const separatorChars = [...numeric].filter(
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
  return decPart ? `${intPart}.${decPart}` : intPart
}

export const enforceIntegerPattern = (value: string) =>
  value.replace(/[^\d]/g, '')

// Convert a Date to an ISO date string suitable for <input type="date" defaultValue>.
export function formatDate(date?: Date) {
  const validDate = date && !Number.isNaN(date.getTime()) ? date : new Date()
  return validDate.toISOString().substring(0, 10)
}

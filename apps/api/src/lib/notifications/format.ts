import {
  defaultLocale,
  formatCurrency,
  formatDateOnly,
  getCurrency,
  resolveFormattingLocale,
} from '@spliit/domain'

function safeFormattingLocale(locale: string): string {
  try {
    return resolveFormattingLocale(locale)
  } catch {
    return resolveFormattingLocale(defaultLocale)
  }
}

export function formatNotificationAmount(
  cents: number | null | undefined,
  currencyCode: string | null | undefined,
  locale: string,
): string | null {
  if (cents == null) return null
  const currency = currencyCode ? getCurrency(currencyCode) : undefined
  const formattingLocale = safeFormattingLocale(locale)
  if (currency) return formatCurrency(currency, cents, formattingLocale)
  const formatted = new Intl.NumberFormat(formattingLocale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100)
  return currencyCode ? `${formatted} ${currencyCode}` : formatted
}

export function formatNotificationDate(
  value: string | Date | null | undefined,
  locale: string,
): string | null {
  if (value == null) return null
  const date =
    typeof value === 'string' ? new Date(`${value}T00:00:00.000Z`) : value
  if (Number.isNaN(date.getTime())) return null
  return formatDateOnly(date, safeFormattingLocale(locale), {
    dateStyle: 'medium',
  })
}

export function formatNotificationNumber(
  value: number,
  locale: string,
): string {
  return new Intl.NumberFormat(safeFormattingLocale(locale)).format(value)
}

export function formatNotificationPercent(
  value: number,
  locale: string,
): string {
  return new Intl.NumberFormat(safeFormattingLocale(locale), {
    style: 'percent',
    maximumFractionDigits: 0,
  }).format(value / 100)
}

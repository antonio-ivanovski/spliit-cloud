import { resolveFormattingLocale } from '@spliit/domain/i18n'

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

export function parseIsoCalendarDate(value: string | undefined): Date | undefined {
  if (!value) return undefined
  const match = ISO_DATE_PATTERN.exec(value)
  if (!match) return undefined

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day, 12)

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return undefined
  }
  return date
}

export function toIsoCalendarDate(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function formatDateInputDisplay(value: string, locale: string): string {
  const date = parseIsoCalendarDate(value)
  if (!date) return ''

  const formatter = new Intl.DateTimeFormat(resolveFormattingLocale(locale), {
    calendar: 'gregory',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
  const parts = formatter.formatToParts(date)
  const lastDatePart = parts.findLastIndex((part) =>
    ['day', 'month', 'year'].includes(part.type),
  )

  // Numeric form controls need only the date fields and their separators;
  // CLDR sometimes appends prose such as Macedonian " г." after the year.
  return parts
    .slice(0, lastDatePart + 1)
    .map((part) => part.value)
    .join('')
}

function normalizeLocaleDigits(value: string, locale: string): string {
  const digits = Array.from(
    new Intl.NumberFormat(resolveFormattingLocale(locale), {
      useGrouping: false,
    }).format(9876543210),
  ).filter((character) => !/[\u200e\u200f\u061c]/u.test(character))
  const digitMap = new Map(
    digits.map((character, index) => [character, String(9 - index)]),
  )

  return Array.from(value)
    .map((character) => digitMap.get(character) ?? character)
    .join('')
}

/** Parse the numeric date order produced by the active formatting locale. */
export function parseDateInputDisplay(
  value: string,
  locale: string,
): Date | undefined {
  const numericParts = normalizeLocaleDigits(value, locale).match(/\d+/g)
  if (!numericParts || numericParts.length !== 3) return undefined

  const order = new Intl.DateTimeFormat(resolveFormattingLocale(locale), {
    calendar: 'gregory',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
    .formatToParts(new Date(2006, 10, 22, 12))
    .filter(
      (part): part is Intl.DateTimeFormatPart & {
        type: 'day' | 'month' | 'year'
      } => ['day', 'month', 'year'].includes(part.type),
    )
    .map((part) => part.type)

  if (order.length !== 3) return undefined
  const fields = Object.fromEntries(
    order.map((field, index) => [field, Number(numericParts[index])]),
  ) as Record<'day' | 'month' | 'year', number>
  if (numericParts[order.indexOf('year')]?.length !== 4) return undefined

  const date = new Date(fields.year, fields.month - 1, fields.day, 12)
  if (
    date.getFullYear() !== fields.year ||
    date.getMonth() !== fields.month - 1 ||
    date.getDate() !== fields.day
  ) {
    return undefined
  }
  return date
}

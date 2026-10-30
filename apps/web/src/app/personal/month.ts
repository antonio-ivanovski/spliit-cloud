/** Calendar-month (`YYYY-MM`) helpers for the Personal section. */

export function formatPersonalMonth(date: Date, timeZone?: string): string {
  if (timeZone) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
    }).formatToParts(date)
    const part = (type: string) =>
      parts.find((candidate) => candidate.type === type)?.value ?? ''
    return `${part('year')}-${part('month')}`
  }
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

export function currentPersonalMonth(timeZone?: string): string {
  return formatPersonalMonth(new Date(), timeZone)
}

export function isValidPersonalMonth(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}$/.test(value)
}

export function shiftPersonalMonth(month: string, delta: number): string {
  const [yearRaw, monthRaw] = month.split('-')
  const date = new Date(
    Date.UTC(Number(yearRaw), Number(monthRaw) - 1 + delta, 1),
  )
  const year = date.getUTCFullYear()
  const nextMonth = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `${year}-${nextMonth}`
}

export function personalMonthLabel(
  month: string,
  locale: string,
  nowMonth?: string,
): string {
  const [yearRaw, monthRaw] = month.split('-')
  const date = new Date(Date.UTC(Number(yearRaw), Number(monthRaw) - 1, 1))
  const label = new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
  if (nowMonth && month === nowMonth) return label
  return label
}

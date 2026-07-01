// Sanitize a user-typed currency string so users can type "1.234,56" or "-10" and get a parseable value.
export const enforceCurrencyPattern = (value: string) =>
  value
    .replace(/^\s*-/, '_')
    .replace(/[.,]/, '#')
    .replace(/[-.,]/g, '')
    .replace(/_/, '-')
    .replace(/#/, '.')
    .replace(/[^-\d.]/g, '')

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

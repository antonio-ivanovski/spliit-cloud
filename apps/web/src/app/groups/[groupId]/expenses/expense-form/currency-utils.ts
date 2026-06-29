// Sanitize a user-typed currency string so users can type "1.234,56" or "-10" and get a parseable value.
export const enforceCurrencyPattern = (value: string) =>
  value
    .replace(/^\s*-/, '_') // replace leading minus with _
    .replace(/[.,]/, '#') // replace first comma with #
    .replace(/[-.,]/g, '') // remove other minus and commas characters
    .replace(/_/, '-') // change back _ to minus
    .replace(/#/, '.') // change back # to dot
    .replace(/[^-\d.]/g, '') // remove all non-numeric characters

// Convert a Date to an ISO date string suitable for <input type="date" defaultValue>.
export function formatDate(date?: Date) {
  if (!date || isNaN(date as any)) date = new Date()
  return date.toISOString().substring(0, 10)
}

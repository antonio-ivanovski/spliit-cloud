// Sanitize a user-typed currency string so users can type "1.234,56" or "-10" and get a parseable value.
export const enforceCurrencyPattern = (value: string) =>
  value
    .replace(/^\s*-/, '_')
    .replace(/[.,]/, '#')
    .replace(/[-.,]/g, '')
    .replace(/_/, '-')
    .replace(/#/, '.')
    .replace(/[^-\d.]/g, '')

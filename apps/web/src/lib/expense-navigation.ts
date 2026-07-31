/**
 * Convert a validated internal return path back into the `/expenses` search
 * object expected by TanStack Router. Invalid or non-global paths are ignored
 * so a stale URL can never become an external navigation target.
 */
export function getGlobalExpensesSearch(returnTo?: string) {
  if (!returnTo || !/^\/expenses(?:\?[^#]*)?$/.test(returnTo)) return undefined

  const url = new URL(returnTo, 'http://spliit.local')
  if (url.pathname !== '/expenses') return undefined

  return Object.fromEntries(url.searchParams.entries())
}

export function isGlobalExpensesReturnTo(returnTo?: string) {
  return getGlobalExpensesSearch(returnTo) !== undefined
}

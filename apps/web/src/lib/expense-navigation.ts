import type { LinkProps } from '@tanstack/react-router'

export type ExpenseCancelLink = Pick<LinkProps, 'to' | 'params' | 'search'>

function globalExpensesLink(returnTo: string): ExpenseCancelLink {
  return {
    to: '/expenses',
    search: getGlobalExpensesSearch(returnTo) as ExpenseCancelLink['search'],
  }
}

/** Cancel from the expense form: group home, or the global expenses feed. */
export function expenseFormCancelLink(
  groupId: string,
  returnTo?: string,
): ExpenseCancelLink {
  if (isGlobalExpensesReturnTo(returnTo) && returnTo) {
    return globalExpensesLink(returnTo)
  }
  return {
    to: '/groups/$groupId',
    params: { groupId },
  }
}

/** Back to the group expense list, or the global expenses feed. */
export function expenseListLink(
  groupId: string,
  returnTo?: string,
): ExpenseCancelLink {
  if (isGlobalExpensesReturnTo(returnTo) && returnTo) {
    return globalExpensesLink(returnTo)
  }
  return {
    to: '/groups/$groupId/expenses',
    params: { groupId },
  }
}

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

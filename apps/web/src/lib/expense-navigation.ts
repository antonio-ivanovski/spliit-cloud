import type { LinkProps } from '@tanstack/react-router'

export type ExpenseCancelLink = Pick<
  LinkProps,
  'to' | 'params' | 'search' | 'resetScroll' | 'replace'
>

/** Keep the list's URL-backed filters and sort while opening a preview. */
export function expensePreviewSearch(returnTo?: string) {
  return (search: Record<string, unknown>) => ({
    ...search,
    ...(returnTo ? { returnTo } : {}),
  })
}

/** Drop only the preview's return path when going back to the group list. */
export function expensePreviewCloseSearch(search: Record<string, unknown>) {
  return { ...search, returnTo: undefined }
}

/** Keep the source list's search state when moving into the edit page. */
export function expenseEditSearch(
  scope?: 'OCCURRENCE' | 'THIS_AND_FUTURE',
  returnTo?: string,
) {
  if (isGlobalExpensesReturnTo(returnTo)) {
    return () => ({ scope, returnTo })
  }
  return (search: Record<string, unknown>) => ({
    ...search,
    ...(scope ? { scope } : {}),
    ...(returnTo ? { returnTo } : {}),
  })
}

/** Cancel and save from edit both return to the source preview. */
export function expenseEditPreviewLink(
  groupId: string,
  expenseId: string,
  returnTo?: string,
): ExpenseCancelLink {
  if (isGlobalExpensesReturnTo(returnTo)) {
    return {
      to: '/expenses',
      search: {
        ...getGlobalExpensesSearch(returnTo),
        expenseId,
        expenseGroupId: groupId,
      } as ExpenseCancelLink['search'],
      resetScroll: false,
      replace: true,
    }
  }
  return {
    to: '/groups/$groupId/expenses/$expenseId',
    params: { groupId, expenseId },
    search: (search: Record<string, unknown>) => ({
      ...search,
      scope: undefined,
    }),
    resetScroll: false,
    replace: true,
  }
}

/** Deletion has no preview to return to, so retain the source list instead. */
export function expenseEditListLink(
  groupId: string,
  returnTo?: string,
): ExpenseCancelLink {
  if (isGlobalExpensesReturnTo(returnTo) && returnTo) {
    return { ...globalExpensesLink(returnTo), resetScroll: false }
  }
  return {
    to: '/groups/$groupId/expenses',
    params: { groupId },
    search: (search: Record<string, unknown>) => ({
      ...search,
      returnTo: undefined,
      scope: undefined,
    }),
    resetScroll: false,
  }
}

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

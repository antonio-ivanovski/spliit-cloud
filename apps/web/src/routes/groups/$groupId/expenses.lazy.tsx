import {
  createLazyFileRoute,
  Outlet,
  useRouterState,
} from '@tanstack/react-router'

import GroupExpensesPageClient from '@/app/groups/[groupId]/expenses/page.client'

/**
 * Child routes that replace the expense list with a full page. Every other
 * expenses child (the list itself, and the view-expense modal) keeps the list
 * mounted so `.motion-stagger` does not replay on open/close.
 */
const EXPENSE_FULL_PAGE_ROUTE_IDS = new Set([
  '/groups/$groupId/expenses/create',
  '/groups/$groupId/expenses/print',
  '/groups/$groupId/expenses/$expenseId/edit',
])

function ExpensesLayout() {
  const showList = useRouterState({
    select: (state) => {
      const leafRouteId = state.matches.at(-1)?.routeId
      return !leafRouteId || !EXPENSE_FULL_PAGE_ROUTE_IDS.has(leafRouteId)
    },
  })

  return (
    <>
      {showList ? <GroupExpensesPageClient /> : null}
      <Outlet />
    </>
  )
}

export const Route = createLazyFileRoute('/groups/$groupId/expenses')({
  component: ExpensesLayout,
})

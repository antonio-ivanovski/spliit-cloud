import { createLazyFileRoute, Outlet } from '@tanstack/react-router'

function ExpensesLayout() {
  return <Outlet />
}

export const Route = createLazyFileRoute('/groups/$groupId/expenses')({
  component: ExpensesLayout,
})

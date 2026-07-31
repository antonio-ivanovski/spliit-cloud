import { createLazyFileRoute, Outlet } from '@tanstack/react-router'

function BudgetsLayout() {
  return <Outlet />
}

export const Route = createLazyFileRoute('/groups/$groupId/budgets')({
  component: BudgetsLayout,
})

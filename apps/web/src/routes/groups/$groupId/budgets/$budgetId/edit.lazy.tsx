import { createLazyFileRoute } from '@tanstack/react-router'

import { BudgetFormPage } from '@/app/groups/[groupId]/budgets/budget-form-page'

function BudgetEditRoute() {
  const { groupId, budgetId } = Route.useParams()
  return <BudgetFormPage groupId={groupId} budgetId={budgetId} />
}

export const Route = createLazyFileRoute(
  '/groups/$groupId/budgets/$budgetId/edit',
)({
  component: BudgetEditRoute,
})

import { createLazyFileRoute } from '@tanstack/react-router'

import { BudgetFormPage } from '@/app/groups/[groupId]/budgets/budget-form-page'

function BudgetCreateRoute() {
  const { groupId } = Route.useParams()
  return <BudgetFormPage groupId={groupId} />
}

export const Route = createLazyFileRoute('/groups/$groupId/budgets/create')({
  component: BudgetCreateRoute,
})

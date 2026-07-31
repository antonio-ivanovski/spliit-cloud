import { createLazyFileRoute, useNavigate } from '@tanstack/react-router'

import { BudgetDetailModal } from '@/app/groups/[groupId]/budgets/detail.client'
import GroupBudgetsPageClient from '@/app/groups/[groupId]/budgets/page.client'

function BudgetDetailRoute() {
  const { groupId, budgetId } = Route.useParams()
  const navigate = useNavigate()
  return (
    <>
      <GroupBudgetsPageClient />
      <BudgetDetailModal
        budgetId={budgetId}
        onClose={() =>
          navigate({
            to: '/groups/$groupId/budgets',
            params: { groupId },
            replace: true,
          })
        }
      />
    </>
  )
}

export const Route = createLazyFileRoute('/groups/$groupId/budgets/$budgetId/')(
  {
    component: BudgetDetailRoute,
  },
)

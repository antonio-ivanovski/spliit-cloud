import { EditExpenseForm } from '@/app/groups/[groupId]/expenses/edit-expense-form'
import { trpc } from '@/trpc/client'
import { createLazyFileRoute, getRouteApi } from '@tanstack/react-router'

const expenseEditRouteApi = getRouteApi(
  '/groups/$groupId/expenses/$expenseId/edit',
)

function ExpenseEditRoute() {
  const { groupId, expenseId } = expenseEditRouteApi.useParams()
  const { data } = trpc.features.get.useQuery()
  if (!data) return null
  return (
    <EditExpenseForm
      groupId={groupId}
      expenseId={expenseId}
      runtimeFeatureFlags={data}
    />
  )
}

export const Route = createLazyFileRoute(
  '/groups/$groupId/expenses/$expenseId/edit',
)({
  component: ExpenseEditRoute,
})

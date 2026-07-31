import { createLazyFileRoute, getRouteApi } from '@tanstack/react-router'

import { EditExpenseForm } from '@/app/groups/[groupId]/expenses/edit-expense-form'
import { Skeleton } from '@/components/ui/skeleton'
import { trpc } from '@/trpc/client'

const expenseEditRouteApi = getRouteApi(
  '/groups/$groupId/expenses/$expenseId/edit',
)

function ExpenseEditRoute() {
  const { groupId, expenseId } = expenseEditRouteApi.useParams()
  const { scope, returnTo } = expenseEditRouteApi.useSearch()
  const { data } = trpc.features.get.useQuery()
  if (!data) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    )
  }
  return (
    <EditExpenseForm
      groupId={groupId}
      expenseId={expenseId}
      runtimeFeatureFlags={data}
      initialScope={scope}
      returnTo={returnTo}
    />
  )
}

export const Route = createLazyFileRoute(
  '/groups/$groupId/expenses/$expenseId/edit',
)({
  component: ExpenseEditRoute,
})

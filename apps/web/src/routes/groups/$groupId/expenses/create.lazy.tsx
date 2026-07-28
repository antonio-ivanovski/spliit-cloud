import { createLazyFileRoute, getRouteApi } from '@tanstack/react-router'

import { CreateExpenseForm } from '@/app/groups/[groupId]/expenses/create-expense-form'
import { Skeleton } from '@/components/ui/skeleton'
import { trpc } from '@/trpc/client'

const groupRouteApi = getRouteApi('/groups/$groupId/expenses/create')

function ExpenseCreateRoute() {
  const { groupId } = groupRouteApi.useParams()
  const { data } = trpc.features.get.useQuery()
  if (!data) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    )
  }
  return <CreateExpenseForm groupId={groupId} runtimeFeatureFlags={data} />
}

export const Route = createLazyFileRoute('/groups/$groupId/expenses/create')({
  component: ExpenseCreateRoute,
})

import { createLazyFileRoute, getRouteApi } from '@tanstack/react-router'

import { CreateExpenseForm } from '@/app/groups/[groupId]/expenses/create-expense-form'
import { Skeleton } from '@/components/ui/skeleton'
import { useEffectiveRuntimeFeatureFlags } from '@/lib/effective-runtime-feature-flags'

const groupRouteApi = getRouteApi('/groups/$groupId/expenses/create')

function ExpenseCreateRoute() {
  const { groupId } = groupRouteApi.useParams()
  const { flags, isLoading } = useEffectiveRuntimeFeatureFlags()
  if (isLoading) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    )
  }
  return <CreateExpenseForm groupId={groupId} runtimeFeatureFlags={flags} />
}

export const Route = createLazyFileRoute('/groups/$groupId/expenses/create')({
  component: ExpenseCreateRoute,
})

import { CreateExpenseForm } from '@/app/groups/[groupId]/expenses/create-expense-form'
import { trpc } from '@/trpc/client'
import { createLazyFileRoute, getRouteApi } from '@tanstack/react-router'

const groupRouteApi = getRouteApi('/groups/$groupId/expenses/create')

function ExpenseCreateRoute() {
  const { groupId } = groupRouteApi.useParams()
  const { data } = trpc.features.get.useQuery()
  if (!data) return null
  return <CreateExpenseForm groupId={groupId} runtimeFeatureFlags={data} />
}

export const Route = createLazyFileRoute('/groups/$groupId/expenses/create')({
  component: ExpenseCreateRoute,
})

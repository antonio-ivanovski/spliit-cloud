import GroupExpensesPageClient from '@/app/groups/[groupId]/expenses/page.client'
import { trpc } from '@/trpc/client'
import { createLazyFileRoute } from '@tanstack/react-router'

function ExpensesRoute() {
  const { data } = trpc.features.get.useQuery()
  return (
    <GroupExpensesPageClient
      enableReceiptExtract={data?.enableReceiptExtract ?? false}
    />
  )
}

export const Route = createLazyFileRoute('/groups/$groupId/expenses/')({
  component: ExpensesRoute,
})

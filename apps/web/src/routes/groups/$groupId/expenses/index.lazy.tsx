import { createLazyFileRoute } from '@tanstack/react-router'

import GroupExpensesPageClient from '@/app/groups/[groupId]/expenses/page.client'

function ExpensesRoute() {
  return <GroupExpensesPageClient />
}

export const Route = createLazyFileRoute('/groups/$groupId/expenses/')({
  component: ExpensesRoute,
})

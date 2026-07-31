import { createLazyFileRoute } from '@tanstack/react-router'

import GroupBudgetsPageClient from '@/app/groups/[groupId]/budgets/page.client'

export const Route = createLazyFileRoute('/groups/$groupId/budgets/')({
  component: GroupBudgetsPageClient,
})

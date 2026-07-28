import { createLazyFileRoute } from '@tanstack/react-router'

import { TotalsPageClient } from '@/app/groups/[groupId]/stats/page.client'

export const Route = createLazyFileRoute('/groups/$groupId/stats')({
  component: TotalsPageClient,
})

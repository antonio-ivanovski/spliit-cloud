import { TotalsPageClient } from '@/app/groups/[groupId]/stats/page.client'
import { createLazyFileRoute } from '@tanstack/react-router'

export const Route = createLazyFileRoute('/groups/$groupId/stats')({
  component: TotalsPageClient,
})

import { ActivityPageClient } from '@/app/groups/[groupId]/activity/page.client'
import { createLazyFileRoute } from '@tanstack/react-router'

export const Route = createLazyFileRoute('/groups/$groupId/activity')({
  component: ActivityPageClient,
})

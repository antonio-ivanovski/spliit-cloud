import { createLazyFileRoute } from '@tanstack/react-router'

import { ActivityPageClient } from '@/app/groups/[groupId]/activity/page.client'

export const Route = createLazyFileRoute('/groups/$groupId/activity')({
  component: ActivityPageClient,
})

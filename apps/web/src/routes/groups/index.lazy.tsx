import { RecentGroupList } from '@/app/groups/recent-group-list'
import { createLazyFileRoute } from '@tanstack/react-router'

export const Route = createLazyFileRoute('/groups/')({
  component: RecentGroupList,
})

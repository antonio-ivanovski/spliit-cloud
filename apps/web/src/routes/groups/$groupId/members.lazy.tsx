import { createLazyFileRoute } from '@tanstack/react-router'

import GroupMembersPage from '@/app/groups/[groupId]/members/page.client'

export const Route = createLazyFileRoute('/groups/$groupId/members')({
  component: GroupMembersPage,
})

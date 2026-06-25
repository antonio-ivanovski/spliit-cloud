import GroupMembersPage from '@/app/groups/[groupId]/members/page.client'
import { createLazyFileRoute } from '@tanstack/react-router'

export const Route = createLazyFileRoute('/groups/$groupId/members')({
  component: GroupMembersPage,
})

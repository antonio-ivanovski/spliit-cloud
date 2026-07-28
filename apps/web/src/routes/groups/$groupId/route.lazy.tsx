import { createLazyFileRoute, getRouteApi } from '@tanstack/react-router'

import { GroupLayoutClient } from '@/app/groups/[groupId]/layout.client'

const groupRouteApi = getRouteApi('/groups/$groupId')

function GroupLayoutRoute() {
  const { groupId } = groupRouteApi.useParams()
  return <GroupLayoutClient groupId={groupId} />
}

export const Route = createLazyFileRoute('/groups/$groupId')({
  component: GroupLayoutRoute,
})

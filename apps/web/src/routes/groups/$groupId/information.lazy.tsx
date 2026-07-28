import { createLazyFileRoute, getRouteApi } from '@tanstack/react-router'

import GroupInformation from '@/app/groups/[groupId]/information/group-information'

const groupRouteApi = getRouteApi('/groups/$groupId/information')

function InformationRoute() {
  const { groupId } = groupRouteApi.useParams()
  return <GroupInformation groupId={groupId} />
}

export const Route = createLazyFileRoute('/groups/$groupId/information')({
  component: InformationRoute,
})

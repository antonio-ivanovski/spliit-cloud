import GroupInformation from '@/app/groups/[groupId]/information/group-information'
import { createLazyFileRoute, getRouteApi } from '@tanstack/react-router'

const groupRouteApi = getRouteApi('/groups/$groupId/information')

function InformationRoute() {
  const { groupId } = groupRouteApi.useParams()
  return <GroupInformation groupId={groupId} />
}

export const Route = createLazyFileRoute('/groups/$groupId/information')({
  component: InformationRoute,
})

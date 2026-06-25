import {
  createLazyFileRoute,
  getRouteApi,
  Navigate,
} from '@tanstack/react-router'

const groupRouteApi = getRouteApi('/groups/$groupId')

function GroupIndexRedirect() {
  const { groupId } = groupRouteApi.useParams()
  return (
    <Navigate to="/groups/$groupId/expenses" params={{ groupId }} replace />
  )
}

export const Route = createLazyFileRoute('/groups/$groupId/')({
  component: GroupIndexRedirect,
})

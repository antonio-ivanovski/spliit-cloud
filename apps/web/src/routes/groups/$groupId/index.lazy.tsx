import {
  createLazyFileRoute,
  getRouteApi,
  Navigate,
} from '@tanstack/react-router'

const groupRouteApi = getRouteApi('/groups/$groupId')

function GroupIndexRedirect() {
  const { groupId } = groupRouteApi.useParams()
  const search = groupRouteApi.useSearch()
  return (
    <Navigate
      to="/groups/$groupId/expenses"
      params={{ groupId }}
      search={search}
      replace
    />
  )
}

export const Route = createLazyFileRoute('/groups/$groupId/')({
  component: GroupIndexRedirect,
})

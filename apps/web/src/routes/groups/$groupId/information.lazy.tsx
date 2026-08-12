import {
  createLazyFileRoute,
  getRouteApi,
  Navigate,
} from '@tanstack/react-router'

const groupRouteApi = getRouteApi('/groups/$groupId/information')

function InformationRedirect() {
  const { groupId } = groupRouteApi.useParams()
  const search = groupRouteApi.useSearch()
  return (
    <Navigate
      to="/groups/$groupId/edit"
      params={{ groupId }}
      search={search}
      replace
    />
  )
}

export const Route = createLazyFileRoute('/groups/$groupId/information')({
  component: InformationRedirect,
})

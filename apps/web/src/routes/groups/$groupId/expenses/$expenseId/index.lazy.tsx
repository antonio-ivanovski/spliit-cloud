import {
  createLazyFileRoute,
  getRouteApi,
  Navigate,
} from '@tanstack/react-router'

// The bare expense URL is reserved for the future view-only expense page.
// Until that ships, direct navigation here redirects to the edit page.
const expenseRouteApi = getRouteApi('/groups/$groupId/expenses/$expenseId/')

function ExpenseRedirect() {
  const { groupId, expenseId } = expenseRouteApi.useParams()
  return (
    <Navigate
      to="/groups/$groupId/expenses/$expenseId/edit"
      params={{ groupId, expenseId }}
      replace
    />
  )
}

export const Route = createLazyFileRoute(
  '/groups/$groupId/expenses/$expenseId/',
)({
  component: ExpenseRedirect,
})

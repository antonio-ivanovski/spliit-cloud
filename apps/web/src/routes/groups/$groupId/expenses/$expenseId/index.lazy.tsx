import {
  createLazyFileRoute,
  getRouteApi,
  useNavigate,
} from '@tanstack/react-router'

import { ExpensePreviewModal } from '@/app/groups/[groupId]/expenses/expense-preview-modal'
import GroupExpensesPageClient from '@/app/groups/[groupId]/expenses/page.client'
import {
  getGlobalExpensesSearch,
  isGlobalExpensesReturnTo,
} from '@/lib/expense-navigation'
import { trpc } from '@/trpc/client'

const expenseRouteApi = getRouteApi('/groups/$groupId/expenses/$expenseId/')

function ExpensePreviewRoute() {
  const { groupId, expenseId } = expenseRouteApi.useParams()
  const { returnTo } = expenseRouteApi.useSearch()
  const { data } = trpc.features.get.useQuery()
  const navigate = useNavigate()
  if (!data) return null
  return (
    <>
      <GroupExpensesPageClient
        enableReceiptExtract={data.enableReceiptExtract ?? false}
      />
      <ExpensePreviewModal
        groupId={groupId}
        expenseId={expenseId}
        returnTo={returnTo}
        onClose={() =>
          isGlobalExpensesReturnTo(returnTo)
            ? navigate({
                to: '/expenses',
                search: getGlobalExpensesSearch(returnTo) as never,
                replace: true,
              })
            : navigate({
                to: '/groups/$groupId/expenses',
                params: { groupId },
                replace: true,
              })
        }
      />
    </>
  )
}

export const Route = createLazyFileRoute(
  '/groups/$groupId/expenses/$expenseId/',
)({
  component: ExpensePreviewRoute,
})

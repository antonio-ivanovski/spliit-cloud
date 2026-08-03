import { createLazyFileRoute, getRouteApi } from '@tanstack/react-router'

import { ReportPrintPage } from '@/app/groups/[groupId]/report-print-page'

const routeApi = getRouteApi('/groups/$groupId/expenses/print')

function ReportPrintRoute() {
  const { groupId } = routeApi.useParams()
  const { from, to } = routeApi.useSearch()
  return <ReportPrintPage groupId={groupId} from={from} to={to} />
}

export const Route = createLazyFileRoute('/groups/$groupId/expenses/print')({
  component: ReportPrintRoute,
})

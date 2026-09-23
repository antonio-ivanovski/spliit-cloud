import {
  createLazyFileRoute,
  getRouteApi,
  useNavigate,
} from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { BulkCategorizePage } from '@/app/groups/[groupId]/bulk-categorize/bulk-categorize-page'
import { CurrentGroupProvider } from '@/app/groups/[groupId]/current-group-context'
import { ExpensePreviewModal } from '@/app/groups/[groupId]/expenses/expense-preview-modal'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { trpc } from '@/trpc/client'

const routeApi = getRouteApi('/groups/bulk-categorize/$groupId')

function BulkCategorizeRoute() {
  const { groupId } = routeApi.useParams()
  const { expenseId } = routeApi.useSearch()
  const navigate = useNavigate({ from: '/groups/bulk-categorize/$groupId' })
  const { data: groupData, isLoading: groupLoading } = trpc.groups.get.useQuery(
    {
      groupId,
    },
  )
  const { t } = useTranslation(undefined, { keyPrefix: 'BulkCategorize' })

  if (groupLoading) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  const group = groupData?.group
  if (!group) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
        </CardHeader>
      </Card>
    )
  }

  const role = groupData?.currentMember?.role
  let blockedReason: 'admin' | 'archived' | null = null
  if (role !== 'ADMIN') blockedReason = 'admin'
  else if (group.archived) blockedReason = 'archived'

  return (
    <CurrentGroupProvider
      isLoading={false}
      groupId={groupId}
      group={group}
      displayName={groupData.displayName ?? group.name}
      currentLedgerParticipantId={groupData.currentLedgerParticipantId ?? null}
      currentMember={groupData.currentMember}
      currentInvitation={groupData.currentInvitation ?? null}
      linkInviteState={groupData.linkInviteState ?? null}
      viewer={groupData.viewer}
      hasSavedView={groupData.hasSavedView}
    >
      <BulkCategorizePage
        groupId={groupId}
        groupName={group.name}
        blockedReason={blockedReason}
        onViewExpense={(id) =>
          void navigate({
            search: { expenseId: id },
            resetScroll: false,
          })
        }
      />
      {expenseId && (
        <ExpensePreviewModal
          groupId={groupId}
          expenseId={expenseId}
          readOnly
          onClose={() =>
            void navigate({ search: {}, replace: true, resetScroll: false })
          }
        />
      )}
    </CurrentGroupProvider>
  )
}

export const Route = createLazyFileRoute('/groups/bulk-categorize/$groupId')({
  component: BulkCategorizeRoute,
})

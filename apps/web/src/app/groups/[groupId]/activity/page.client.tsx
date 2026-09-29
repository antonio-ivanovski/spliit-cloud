import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { ActivityList } from '@/app/groups/[groupId]/activity/activity-list'
import { ExpensePreviewModal } from '@/app/groups/[groupId]/expenses/expense-preview-modal'
import { ScanSurface } from '@/components/layout/scan-surface'
import {
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { buildActivityReturnTo } from '@/lib/expense-navigation'

const activityRouteApi = getRouteApi('/groups/$groupId/activity')

export function ActivityPageClient() {
  const { t } = useTranslation(undefined, { keyPrefix: 'Activity' })
  const { groupId } = activityRouteApi.useParams()
  const { expenseId } = activityRouteApi.useSearch()
  const navigate = useNavigate({ from: '/groups/$groupId/activity' })

  const returnTo = buildActivityReturnTo(groupId)

  const closeExpense = () => {
    void navigate({
      search: (prev) => ({ ...prev, expenseId: undefined }),
      replace: true,
      resetScroll: false,
    })
  }

  return (
    <>
      <ScanSurface className="mb-4">
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col space-y-4 p-0 pb-4 sm:p-0 sm:pb-6">
          <ActivityList />
        </CardContent>
      </ScanSurface>
      {expenseId && (
        <ExpensePreviewModal
          groupId={groupId}
          expenseId={expenseId}
          returnTo={returnTo}
          onClose={closeExpense}
        />
      )}
    </>
  )
}

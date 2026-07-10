import { BulkCategorizePage } from '@/app/groups/[groupId]/bulk-categorize/bulk-categorize-page'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { trpc } from '@/trpc/client'
import { createLazyFileRoute, getRouteApi } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

const routeApi = getRouteApi('/groups/bulk-categorize/$groupId')

function BulkCategorizeRoute() {
  const { groupId } = routeApi.useParams()
  const { data: features, isLoading: featuresLoading } =
    trpc.features.get.useQuery()
  const { data: groupData, isLoading: groupLoading } = trpc.groups.get.useQuery(
    {
      groupId,
    },
  )
  const { t } = useTranslation(undefined, { keyPrefix: 'BulkCategorize' })

  if (featuresLoading || groupLoading) {
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
  let blockedReason: 'admin' | 'archived' | 'feature' | null = null
  if (role !== 'ADMIN') blockedReason = 'admin'
  else if (group.archived) blockedReason = 'archived'
  else if (!features?.enableBulkCategorize) blockedReason = 'feature'

  return (
    <BulkCategorizePage
      groupId={groupId}
      groupName={group.name}
      blockedReason={blockedReason}
    />
  )
}

export const Route = createLazyFileRoute('/groups/bulk-categorize/$groupId')({
  component: BulkCategorizeRoute,
})

import { useTranslation } from 'react-i18next'

import { ActivityList } from '@/app/groups/[groupId]/activity/activity-list'
import { ScanSurface } from '@/components/layout/scan-surface'
import {
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export function ActivityPageClient() {
  const { t } = useTranslation(undefined, { keyPrefix: 'Activity' })

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
    </>
  )
}

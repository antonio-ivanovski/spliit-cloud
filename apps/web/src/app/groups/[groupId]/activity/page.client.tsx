import { useTranslation } from 'react-i18next'

import { ActivityList } from '@/app/groups/[groupId]/activity/activity-list'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export function ActivityPageClient() {
  const { t } = useTranslation(undefined, { keyPrefix: 'Activity' })

  return (
    <>
      <Card className="mobile-surface mb-4">
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col space-y-4">
          <ActivityList />
        </CardContent>
      </Card>
    </>
  )
}

import { StatsDashboard } from '@/app/groups/[groupId]/stats/dashboard'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { useTranslation } from 'react-i18next'

export function TotalsPageClient() {
  const { t } = useTranslation(undefined, { keyPrefix: 'Stats' })

  return (
    <>
      <Card className="mb-4">
        <CardHeader>
          <CardTitle>{t('Dashboard.title')}</CardTitle>
          <CardDescription>{t('Dashboard.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <StatsDashboard />
        </CardContent>
      </Card>
    </>
  )
}

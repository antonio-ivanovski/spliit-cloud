import { useTranslation } from 'react-i18next'

import { StatsDashboard } from '@/app/groups/[groupId]/stats/dashboard'
import { PageInset } from '@/components/layout/page-shell'
import { CardDescription, CardTitle } from '@/components/ui/card'

export function TotalsPageClient() {
  const { t } = useTranslation(undefined, { keyPrefix: 'Stats' })

  return (
    <div className="mb-4 flex flex-col gap-4 sm:mb-6 sm:gap-6">
      <PageInset>
        <header data-testid="stats-page-heading">
          <CardTitle>{t('Dashboard.title')}</CardTitle>
          <CardDescription>{t('Dashboard.description')}</CardDescription>
        </header>
      </PageInset>
      <StatsDashboard />
    </div>
  )
}

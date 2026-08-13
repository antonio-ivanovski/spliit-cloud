import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import type { NormalizedSource } from '@spliit/domain/import'

export function LegacyExportWarning({ source }: { source: NormalizedSource }) {
  const { t } = useTranslation()
  if (
    source.provider !== 'SPLIIT' ||
    source.sourceGroupId === 'csv-import' ||
    source.exportVersion === 3
  ) {
    return null
  }
  return (
    <Alert>
      <AlertTitle>{t('Groups.Import.Source.legacyExportTitle')}</AlertTitle>
      <AlertDescription>
        {t('Groups.Import.Source.legacyExportDescription')}
      </AlertDescription>
    </Alert>
  )
}

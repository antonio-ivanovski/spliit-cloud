import { AlertTriangle, WifiOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { useOnlineStatus } from '@/lib/use-online-status'

export function QueryErrorState({
  onRetry,
  onBack,
  compact = false,
}: {
  onRetry?: () => void
  onBack?: () => void
  compact?: boolean
}) {
  const isOnline = useOnlineStatus()
  const { t } = useTranslation(undefined, { keyPrefix: 'OfflineData' })

  return (
    <div
      role="alert"
      className={
        compact
          ? 'flex flex-col items-center gap-3 py-6 text-center'
          : 'mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-10 text-center'
      }
    >
      {isOnline ? (
        <AlertTriangle
          className="h-6 w-6 text-destructive"
          aria-hidden="true"
        />
      ) : (
        <WifiOff className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
      )}
      <h2 className="text-lg font-semibold">{t('errorTitle')}</h2>
      <p className="text-sm text-muted-foreground">
        {isOnline ? t('errorDescription') : t('offlineDescription')}
      </p>
      <div className="flex gap-2">
        {onRetry && (
          <Button type="button" onClick={onRetry}>
            {t('retry')}
          </Button>
        )}
        {onBack && (
          <Button type="button" variant="outline" onClick={onBack}>
            {t('back')}
          </Button>
        )}
      </div>
    </div>
  )
}

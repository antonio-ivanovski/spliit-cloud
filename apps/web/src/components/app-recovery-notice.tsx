import { AlertTriangle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  clearAppCachesAndServiceWorker,
  reloadWithFreshDocument,
  subscribeToRecoveryRequired,
} from '@/lib/app-recovery'

/**
 * Shown only after a fresh app-code request failed twice. Keeping this as a
 * small in-app action avoids an automatic reload loop while still giving the
 * user a reliable way to recover from an old deployment's cached chunks.
 */
export function AppRecoveryNotice() {
  const { t } = useTranslation()
  const [visible, setVisible] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [isOffline, setIsOffline] = useState(
    () => typeof navigator !== 'undefined' && !navigator.onLine,
  )

  useEffect(() => {
    const unsubscribe = subscribeToRecoveryRequired(() => setVisible(true))
    const update = () => setIsOffline(!navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      unsubscribe()
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  if (!visible) return null

  const handleRefresh = async () => {
    setRefreshing(true)
    await clearAppCachesAndServiceWorker()
    reloadWithFreshDocument()
  }

  return (
    <div
      role="alert"
      data-testid="app-recovery-notice"
      className="fixed inset-x-0 top-0 z-[100] border-b border-red-300 bg-red-50 px-4 py-3 text-red-950 shadow-sm dark:border-red-900 dark:bg-red-950 dark:text-red-100"
    >
      <div className="mx-auto flex max-w-3xl items-center justify-center gap-3 text-sm">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
        <p className="flex-1">{t('OfflineBanner.message')}</p>
        {!isOffline && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            {t('ExpenseForm.conversionRateState.refresh')}
          </Button>
        )}
      </div>
    </div>
  )
}

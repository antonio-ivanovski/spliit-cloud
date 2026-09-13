/* oxlint-disable jsx-a11y/prefer-tag-over-role -- status role is retained for the live update announcement. */
import { RefreshCw } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { getPwaUpdateManager } from '@/lib/pwa-update-manager'

/**
 * Recovery UI for an update that failed to apply. Normal waits stay silent: the
 * manager preserves unfinished work and retries automatically when safe,
 * including when another window becomes available. Only failures need a Retry
 * action; checking, applying, and restarting never announce routine updates.
 */
export function PwaUpdatePill() {
  const { t } = useTranslation(undefined, { keyPrefix: 'PwaUpdate' })
  const manager = getPwaUpdateManager()
  const snapshot = useSyncExternalStore(
    manager.subscribe,
    manager.getSnapshot,
    manager.getSnapshot,
  )

  if (snapshot.status !== 'failed' || snapshot.dismissed) return null

  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(var(--app-header-height)+0.5rem)] z-40 flex justify-center px-4">
      <div
        role="status"
        className="pointer-events-auto flex max-w-full items-center gap-2 rounded-full border bg-background/95 py-1.5 ps-4 pe-1.5 shadow-lg backdrop-blur"
      >
        <RefreshCw
          className="size-4 shrink-0 text-primary"
          aria-hidden="true"
        />
        <span className="truncate text-sm font-medium">
          {t('waitingFailed')}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 shrink-0 rounded-full"
          onClick={() => manager.dismissFailure()}
        >
          {t('dismiss')}
        </Button>
        <Button
          type="button"
          variant="default"
          size="sm"
          className="h-8 shrink-0 rounded-full"
          onClick={() => manager.retry()}
        >
          {t('retry')}
        </Button>
      </div>
    </div>
  )
}

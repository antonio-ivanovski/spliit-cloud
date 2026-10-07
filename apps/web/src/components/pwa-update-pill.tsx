import { Effect } from 'effect'
/* oxlint-disable jsx-a11y/prefer-tag-over-role -- status role is retained for the live update announcement. */
import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  INITIAL_PWA_UPDATE_CHECK,
  type PwaUpdateService,
  type PwaUpdateServiceSnapshot,
} from '@/lib/services/pwa-updates'
import { getPwaPageServices } from '@/lib/services/pwa-wiring'
import {
  createSnapshotBridge,
  useServiceSnapshot,
} from '@/lib/services/snapshot'

// Closed-state bridge for renders without a page bundle (SSR, unit tests
// that render presentation without injecting a service). Never publishes.
const CLOSED_UPDATE: PwaUpdateServiceSnapshot = {
  update: { status: 'hidden' },
  check: INITIAL_PWA_UPDATE_CHECK,
}
const CLOSED_BRIDGE = createSnapshotBridge(CLOSED_UPDATE)

/**
 * Recovery UI for an update that failed to apply (Task 8: bound to the PWA
 * update service, not the manager singleton). Normal waits stay silent: the
 * manager preserves unfinished work and retries automatically when safe,
 * including when another window becomes available. Only failures need a Retry
 * action; checking, applying, and restarting never announce routine updates.
 *
 * The optional service prop is the test seam (fresh instances per test);
 * production resolves the page bundle whose service owns the manager.
 */
export function PwaUpdatePill(props?: { readonly service?: PwaUpdateService }) {
  const { t } = useTranslation(undefined, { keyPrefix: 'PwaUpdate' })
  const service = props?.service ?? getPwaPageServices()?.updates ?? null
  const update = useServiceSnapshot(
    service?.bridge ?? CLOSED_BRIDGE,
    (snapshot) => snapshot.update,
  )

  if (!service || update.status !== 'failed' || update.dismissed) return null

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
          onClick={() => {
            void Effect.runPromise(service.dismissFailure).catch(
              () => undefined,
            )
          }}
        >
          {t('dismiss')}
        </Button>
        <Button
          type="button"
          variant="default"
          size="sm"
          className="h-8 shrink-0 rounded-full"
          onClick={() => {
            void Effect.runPromise(service.retry).catch(() => undefined)
          }}
        >
          {t('retry')}
        </Button>
      </div>
    </div>
  )
}

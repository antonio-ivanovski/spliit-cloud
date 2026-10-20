import { Effect } from 'effect'
import { RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import type { PwaUpdateSnapshot } from '@/lib/pwa-update-manager'
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

const CLOSED_BRIDGE = createSnapshotBridge<PwaUpdateServiceSnapshot>({
  update: { status: 'hidden' },
  check: INITIAL_PWA_UPDATE_CHECK,
})

/** A dedicated notice: ordinary toasts cannot replace an imminent restart. */
export function PwaUpdatePill(props?: { readonly service?: PwaUpdateService }) {
  const { t } = useTranslation(undefined, { keyPrefix: 'PwaUpdate' })
  const service = props?.service ?? getPwaPageServices()?.updates ?? null
  const update = useServiceSnapshot(
    service?.bridge ?? CLOSED_BRIDGE,
    (state) => state.update,
  )
  const [dismissed, setDismissed] = useState<PwaUpdateSnapshot | null>(null)
  useEffect(() => {
    if (update.status !== 'updated') return
    const timer = window.setTimeout(() => setDismissed(update), 5000)
    return () => window.clearTimeout(timer)
  }, [update])

  if (
    !service ||
    update.status === 'hidden' ||
    update === dismissed ||
    (update.status === 'failed' && update.dismissed) ||
    typeof document === 'undefined'
  )
    return null

  const version = 'version' in update ? update.version : undefined
  const title =
    update.status === 'updated'
      ? t('updatedVersion', { version })
      : version
        ? t('availableVersion', { version })
        : t('available')
  const description =
    update.status === 'blocked'
      ? t('blocked')
      : update.status === 'countdown'
        ? t('countdown', { version, seconds: update.seconds })
        : update.status === 'applying'
          ? t('applying')
          : update.status === 'restoring'
            ? t('restoring')
            : update.status === 'recovery-failed'
              ? t('recoveryFailed')
              : update.status === 'failed'
                ? t('waitingFailed')
                : update.restored
                  ? t('draftRestored')
                  : null
  const run = (effect: Effect.Effect<void>) => {
    void Effect.runPromise(effect).catch(() => {})
  }

  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 top-[calc(var(--app-header-height)+0.5rem)] z-50 flex justify-center px-4">
      {/* A stable live title announces the update once, rather than each countdown tick. */}
      <div className="pointer-events-auto flex max-w-lg items-center gap-3 rounded-xl border bg-background/95 p-3 shadow-lg backdrop-blur">
        <RefreshCw
          className="size-4 shrink-0 text-primary"
          aria-hidden="true"
        />
        <div className="min-w-0 text-sm">
          <p className="font-medium" aria-live="polite">
            {title}
          </p>
          {description && <p>{description}</p>}
        </div>
        {update.status === 'countdown' && (
          <Button size="sm" onClick={() => run(service.updateNow)}>
            {t('updateNow')}
          </Button>
        )}
        {(update.status === 'failed' ||
          update.status === 'recovery-failed') && (
          <div className="flex shrink-0 gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setDismissed(update)
                run(service.dismissFailure)
              }}
            >
              {t('dismiss')}
            </Button>
            <Button size="sm" onClick={() => run(service.retry)}>
              {t('retry')}
            </Button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

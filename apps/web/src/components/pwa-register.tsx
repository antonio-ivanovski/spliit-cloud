import { RefreshCw, TriangleAlert } from 'lucide-react'
import { useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
import { getPwaUpdateManager } from '@/lib/pwa-update-manager'

/**
 * Presents an installed update without interrupting the running application.
 * Registration starts before React mounts in `main.tsx`; this component only
 * subscribes to that singleton lifecycle and owns the in-session prompt.
 */
export function PwaRegister() {
  const { t } = useTranslation(undefined, { keyPrefix: 'PwaUpdate' })
  const [confirmForceRestart, setConfirmForceRestart] = useState(false)
  const manager = getPwaUpdateManager()
  const snapshot = useSyncExternalStore(
    manager.subscribe,
    manager.getSnapshot,
    manager.getSnapshot,
  )
  const open =
    snapshot.status === 'available' || snapshot.status === 'restarting'
  const restarting = snapshot.status === 'restarting'
  const checkingClients = snapshot.checkingClients === true
  const blocked = snapshot.otherClientsBlocked === true
  const canForceRestart = blocked || snapshot.forceRestartAvailable === true
  const showingForceConfirmation = canForceRestart && confirmForceRestart

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !restarting && !checkingClients) {
          setConfirmForceRestart(false)
          manager.deferUntilNextLaunch()
        }
      }}
    >
      <ResponsiveDialogContent showCloseButton={false} className="max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2">
            {showingForceConfirmation ? (
              <TriangleAlert
                className="size-5 text-destructive"
                aria-hidden="true"
              />
            ) : (
              <RefreshCw className="size-5 text-primary" aria-hidden="true" />
            )}
            {showingForceConfirmation ? t('forceTitle') : t('title')}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {showingForceConfirmation
              ? t('forceDescription')
              : t('description')}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        {!showingForceConfirmation && (
          <ResponsiveDialogBody className="space-y-3">
            <p className="text-sm text-foreground">{t('unsavedWarning')}</p>
            <p className="text-sm text-muted-foreground">
              {t('nextLaunchNote')}
            </p>
            {blocked && (
              <div className="flex gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-950 dark:text-amber-100">
                <TriangleAlert
                  className="mt-0.5 size-4 shrink-0"
                  aria-hidden="true"
                />
                <p>
                  {snapshot.otherClientCount === undefined
                    ? t('clientCheckFailed')
                    : t('otherClientsCountWarning', {
                        count: snapshot.otherClientCount,
                      })}
                </p>
              </div>
            )}
            {snapshot.error === 'restart' && (
              <p className="text-sm text-destructive" role="alert">
                {t('restartFailed')}
              </p>
            )}
          </ResponsiveDialogBody>
        )}
        <ResponsiveDialogFooter className="gap-2 sm:flex-wrap sm:space-x-0">
          {showingForceConfirmation ? (
            <>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setConfirmForceRestart(false)}
              >
                {t('cancel')}
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => {
                  setConfirmForceRestart(false)
                  void manager.forceRestartAll()
                }}
              >
                {t('restartAll')}
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="secondary"
                disabled={restarting || checkingClients}
                onClick={() => manager.deferUntilNextLaunch()}
              >
                {t('later')}
              </Button>
              <Button
                type="button"
                variant="default"
                disabled={restarting || checkingClients}
                onClick={() => void manager.restartNow()}
              >
                {restarting
                  ? t('restarting')
                  : checkingClients
                    ? t('checkingOtherClients')
                    : t('restartNow')}
              </Button>
              {canForceRestart && (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => setConfirmForceRestart(true)}
                >
                  {t('restartAllAnyway')}
                </Button>
              )}
            </>
          )}
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}

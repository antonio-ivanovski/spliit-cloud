import { useLocation } from '@tanstack/react-router'
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  ResponsiveDialog as Dialog,
  ResponsiveDialogBody as DialogBody,
  ResponsiveDialogContent as DialogContent,
  ResponsiveDialogDescription as DialogDescription,
  ResponsiveDialogFooter as DialogFooter,
  ResponsiveDialogHeader as DialogHeader,
  ResponsiveDialogTitle as DialogTitle,
} from '@/components/ui/responsive-dialog'
import {
  acknowledgeAnonymousRecovery,
  getAnonymousRecoveryStatus,
  replacePendingAnonymousRecovery,
  setupAnonymousRecovery,
  type AnonymousRecoveryKey,
  type AnonymousRecoveryStatus,
} from '@/lib/anonymous-recovery'
import { replaceBrowserLocation } from '@/lib/browser-navigation'
import { useCurrentAccount } from '@/lib/use-current-account'

import { AnonymousRecoveryKeyPanel } from './anonymous-recovery-key-panel'

export const ANONYMOUS_REDIRECT_STORAGE_KEY = 'spliit.anonymous.redirect'

export function AnonymousOnboardingGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation(undefined, {
    keyPrefix: 'AnonymousAccount.onboarding',
  })
  const pathname = useLocation({ select: (location) => location.pathname })
  const isRecoveryRoute = pathname === '/auth/recover'
  const { data: account, isPending: accountPending } = useCurrentAccount()
  const [status, setStatus] = useState<AnonymousRecoveryStatus | null>(null)
  const [recovery, setRecovery] = useState<AnonymousRecoveryKey | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const acknowledgingRef = useRef(false)

  const load = useCallback(async () => {
    if (isRecoveryRoute || !account?.isAnonymous) return
    setLoading(true)
    setError(null)
    try {
      const nextStatus = await getAnonymousRecoveryStatus()
      setStatus(nextStatus)
      if (!nextStatus.acknowledged) {
        setRecovery(await setupAnonymousRecovery())
      }
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : String(cause)
      setError(code)
    } finally {
      setLoading(false)
    }
  }, [account?.isAnonymous, isRecoveryRoute])

  useEffect(() => {
    queueMicrotask(() => void load())
  }, [load])

  if (isRecoveryRoute) return <>{children}</>
  if (accountPending) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </main>
    )
  }
  if (!account?.isAnonymous) return <>{children}</>
  if (status?.acknowledged && status.onboardingCompleted) return <>{children}</>
  if (!error && (status === null || (loading && !recovery))) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </main>
    )
  }

  async function acknowledge() {
    if (!confirmed || acknowledgingRef.current) return
    acknowledgingRef.current = true
    setLoading(true)
    setError(null)
    try {
      await acknowledgeAnonymousRecovery({ confirmedCopied: true })
      const redirect =
        sessionStorage.getItem(ANONYMOUS_REDIRECT_STORAGE_KEY) ?? '/'
      sessionStorage.removeItem(ANONYMOUS_REDIRECT_STORAGE_KEY)
      const search = new URLSearchParams({ redirect })
      replaceBrowserLocation(`/auth/complete-profile?${search.toString()}`)
    } catch {
      acknowledgingRef.current = false
      setError('ACKNOWLEDGE_FAILED')
      setLoading(false)
    }
  }

  async function replaceUnavailableKey() {
    setLoading(true)
    setError(null)
    try {
      setRecovery(await replacePendingAnonymousRecovery())
      setConfirmed(false)
    } catch {
      setError('ROTATE_FAILED')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <Dialog
        open
        disablePointerDismissal
        onOpenChange={(_open, details) => details.cancel()}
      >
        <DialogContent
          showCloseButton={false}
          className="max-h-[94dvh] overflow-y-auto sm:max-w-xl"
        >
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>{t('description')}</DialogDescription>
          </DialogHeader>

          <DialogBody>
            {loading && !recovery ? (
              <div className="flex min-h-48 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : recovery ? (
              <div className="flex flex-col gap-5">
                <AnonymousRecoveryKeyPanel
                  recovery={recovery}
                  confirmed={confirmed}
                  onConfirmedChange={setConfirmed}
                />
              </div>
            ) : (
              <div className="flex flex-col items-center gap-4 rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center">
                <AlertTriangle className="h-7 w-7 text-destructive" />
                <div>
                  <p className="font-medium">{t('unavailableTitle')}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t('unavailableDescription')}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void replaceUnavailableKey()}
                  disabled={loading}
                >
                  <RefreshCw className="me-2 h-4 w-4" />
                  {t('generateReplacement')}
                </Button>
              </div>
            )}

            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {t('error')}
              </p>
            ) : null}
          </DialogBody>

          {recovery ? (
            <DialogFooter>
              <Button
                type="button"
                className="w-full sm:w-auto"
                disabled={loading || !confirmed}
                onClick={() => void acknowledge()}
              >
                {loading ? (
                  <Loader2 className="me-2 h-4 w-4 animate-spin" />
                ) : null}
                {t('start')}
              </Button>
            </DialogFooter>
          ) : null}
        </DialogContent>
      </Dialog>
    </main>
  )
}

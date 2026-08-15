import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { OfflineEmptyState } from '@/components/offline-empty-state'
import { Button } from '@/components/ui/button'
import {
  acknowledgeAnonymousRecovery,
  getAnonymousRecoveryStatus,
  replacePendingAnonymousRecovery,
  setupAnonymousRecovery,
  type AnonymousRecoveryKey,
} from '@/lib/anonymous-recovery'
import { reportNetworkFailure } from '@/lib/connectivity'
import { isNetworkError } from '@/lib/network-error'
import { useOnlineStatus } from '@/lib/use-online-status'

import { AnonymousRecoveryKeyPanel } from './anonymous-recovery-key-panel'

export function AnonymousRecoveryOnboarding({
  onComplete,
}: {
  onComplete: () => void | Promise<void>
}) {
  const { t } = useTranslation(undefined, {
    keyPrefix: 'AnonymousAccount.onboarding',
  })
  const isOnline = useOnlineStatus()
  const [recovery, setRecovery] = useState<AnonymousRecoveryKey | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [networkFailed, setNetworkFailed] = useState(false)
  const acknowledgingRef = useRef(false)

  useEffect(() => {
    if (!isOnline) return
    let active = true
    queueMicrotask(() => {
      if (!active) return
      void (async () => {
        setLoading(true)
        setError(null)
        setNetworkFailed(false)
        try {
          const status = await getAnonymousRecoveryStatus()
          if (!active) return
          if (status.acknowledged && status.onboardingCompleted) {
            await onComplete()
            return
          }
          if (!status.acknowledged) {
            const nextRecovery = await setupAnonymousRecovery()
            if (active) setRecovery(nextRecovery)
          }
        } catch (cause) {
          if (!active) return
          if (isNetworkError(cause)) {
            reportNetworkFailure(cause)
            setNetworkFailed(true)
            return
          }
          const code = cause instanceof Error ? cause.message : String(cause)
          if (code === 'RECOVERY_KEY_ALREADY_ACKNOWLEDGED') {
            await onComplete()
            return
          }
          setError(code)
        } finally {
          if (active) setLoading(false)
        }
      })()
    })
    return () => {
      active = false
    }
  }, [isOnline, onComplete])

  async function acknowledge() {
    if (!confirmed || !recovery || acknowledgingRef.current) return
    acknowledgingRef.current = true
    setLoading(true)
    setError(null)
    try {
      await acknowledgeAnonymousRecovery({
        confirmedCopied: true,
        code: recovery.code,
      })
      await onComplete()
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

  if (!isOnline || networkFailed) {
    return <OfflineEmptyState variant="plain" />
  }

  if (loading && !recovery) {
    return (
      <div className="flex min-h-48 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="space-y-2 text-center">
        <h2 className="text-2xl font-semibold tracking-tight">{t('title')}</h2>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </div>

      {recovery ? (
        <AnonymousRecoveryKeyPanel
          recovery={recovery}
          confirmed={confirmed}
          onConfirmedChange={setConfirmed}
        />
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

      {recovery ? (
        <Button
          type="button"
          className="w-full"
          disabled={loading || !confirmed}
          onClick={() => void acknowledge()}
        >
          {loading ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}
          {t('start')}
        </Button>
      ) : null}
    </div>
  )
}

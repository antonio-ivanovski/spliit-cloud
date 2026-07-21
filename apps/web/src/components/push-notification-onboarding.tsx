import { Button } from '@/components/ui/button'
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
import { needsDisplayName } from '@/lib/account'
import { useCurrentAccount } from '@/lib/use-current-account'
import { usePushNotifications } from '@/lib/use-push-notifications'
import { trpc } from '@/trpc/client'
import {
  ACTIVE_NOTIFICATION_CATEGORIES,
  NotificationChannel,
} from '@spliit/domain/notifications'
import { BellRing, Mail, Smartphone } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

export const PUSH_ONBOARDING_ACTIVE_KEY = 'spliit-push-onboarding-active'
export const PUSH_ONBOARDING_COMPLETE_PREFIX =
  'spliit-push-onboarding-complete:'
export const PUSH_ONBOARDING_COMPLETE_EVENT = 'spliit:push-onboarding-complete'
const PUSH_ONBOARDING_ACTIVE_TTL_MS = 10_000
const PUSH_ONBOARDING_ACTIVE_REFRESH_MS = 3_000

type ActiveOnboarding = {
  token: string
  expiresAt: number
}

function completionKey(accountId: string) {
  return `${PUSH_ONBOARDING_COMPLETE_PREFIX}${accountId}`
}

function hasCompleted(accountId: string) {
  try {
    return localStorage.getItem(completionKey(accountId)) === 'true'
  } catch {
    return false
  }
}

function recordCompleted(accountId: string) {
  try {
    localStorage.setItem(completionKey(accountId), 'true')
  } catch {
    // A blocked storage API must not prevent notification onboarding.
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(PUSH_ONBOARDING_COMPLETE_EVENT))
  }
}

function readActive(): ActiveOnboarding | null {
  try {
    const raw = localStorage.getItem(PUSH_ONBOARDING_ACTIVE_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<ActiveOnboarding>
    if (
      typeof value.token !== 'string' ||
      typeof value.expiresAt !== 'number'
    ) {
      localStorage.removeItem(PUSH_ONBOARDING_ACTIVE_KEY)
      return null
    }
    return { token: value.token, expiresAt: value.expiresAt }
  } catch {
    return null
  }
}

function writeActive(token: string) {
  try {
    localStorage.setItem(
      PUSH_ONBOARDING_ACTIVE_KEY,
      JSON.stringify({
        token,
        expiresAt: Date.now() + PUSH_ONBOARDING_ACTIVE_TTL_MS,
      } satisfies ActiveOnboarding),
    )
  } catch {
    // Install promotion still has a timer fallback if storage is unavailable.
  }
}

function refreshActive(token: string) {
  if (readActive()?.token === token) writeActive(token)
}

function clearActive(token: string) {
  try {
    if (readActive()?.token === token) {
      localStorage.removeItem(PUSH_ONBOARDING_ACTIVE_KEY)
    }
  } catch {
    // The install promotion's polling remains safe if storage is unavailable.
  }
}

export function isPushOnboardingActive() {
  const active = readActive()
  if (!active) return false
  if (active.expiresAt <= Date.now()) {
    clearActive(active.token)
    return false
  }
  return true
}

function tryAcquireActive(token: string) {
  const current = readActive()
  if (current && current.expiresAt > Date.now()) {
    return current.token === token
  }
  if (current) clearActive(current.token)
  writeActive(token)
  return readActive()?.token === token
}

/**
 * Presents push setup once for each signed-in account in this browser. The
 * browser permission request remains inside the explicit Enable button's
 * event handler, which is required by browser security policies.
 */
export function PushNotificationOnboarding() {
  const { t } = useTranslation()
  const { data: account, isPending: accountPending } = useCurrentAccount()
  const push = usePushNotifications()
  const utils = trpc.useUtils()
  const savePreferences = trpc.notifications.preferences.save.useMutation()
  const [isOpen, setIsOpen] = useState(false)
  const [result, setResult] = useState<'email' | 'denied' | 'failed' | null>(
    null,
  )
  const [isEnabling, setIsEnabling] = useState(false)
  const [preferenceError, setPreferenceError] = useState(false)
  const [coordinationVersion, setCoordinationVersion] = useState(0)
  const activeToken = useRef<string | null>(null)

  const accountId = account?.id
  const eligible = useMemo(
    () =>
      !!accountId &&
      !accountPending &&
      !needsDisplayName(account) &&
      push.supported &&
      push.configured &&
      !push.iosHomeScreenRequired &&
      !push.enabled,
    [account, accountId, accountPending, push],
  )

  useEffect(() => {
    if (!eligible || !accountId || hasCompleted(accountId)) return
    const token = `${accountId}:${Date.now()}:${Math.random()}`
    if (!tryAcquireActive(token)) {
      const owner = readActive()
      const retryDelay = owner
        ? Math.max(10, owner.expiresAt - Date.now() + 10)
        : 50
      const retry = window.setTimeout(
        () => setCoordinationVersion((value) => value + 1),
        retryDelay,
      )
      return () => window.clearTimeout(retry)
    }
    activeToken.current = token
    const timer = window.setTimeout(() => {
      if (readActive()?.token !== token) {
        if (activeToken.current === token) activeToken.current = null
        setCoordinationVersion((value) => value + 1)
        return
      }
      setIsOpen(true)
    }, 700)
    const refresh = window.setInterval(
      () => refreshActive(token),
      PUSH_ONBOARDING_ACTIVE_REFRESH_MS,
    )
    return () => {
      window.clearTimeout(timer)
      window.clearInterval(refresh)
      clearActive(token)
      if (activeToken.current === token) activeToken.current = null
    }
  }, [accountId, coordinationVersion, eligible])

  const releaseActive = useCallback(() => {
    if (!activeToken.current) return
    clearActive(activeToken.current)
    activeToken.current = null
  }, [])

  const finishAndClose = useCallback(() => {
    if (!accountId) return
    recordCompleted(accountId)
    releaseActive()
    setResult(null)
    setIsOpen(false)
  }, [accountId, releaseActive])

  const saveEmailPreference = useCallback(async () => {
    if (!accountId) throw new Error('No active account')
    await savePreferences.mutateAsync({
      preferences: [
        ...ACTIVE_NOTIFICATION_CATEGORIES.map((category) => ({
          category,
          channels: [NotificationChannel.EMAIL],
        })),
      ],
    })
    await utils.notifications.preferences.get.invalidate({ accountId })
  }, [accountId, savePreferences, utils])

  const chooseEmail = useCallback(async () => {
    setPreferenceError(false)
    try {
      await saveEmailPreference()
      finishAndClose()
    } catch {
      setPreferenceError(true)
    }
  }, [finishAndClose, saveEmailPreference])

  const closeResult = useCallback(() => {
    releaseActive()
    setIsOpen(false)
  }, [releaseActive])

  useEffect(() => {
    if (!accountId) return
    const handleStorage = (event: StorageEvent) => {
      if (event.key === completionKey(accountId) && event.newValue === 'true') {
        releaseActive()
        setIsOpen(false)
        return
      }
      if (event.key !== PUSH_ONBOARDING_ACTIVE_KEY) return
      const current = readActive()
      if (activeToken.current && current?.token !== activeToken.current) {
        activeToken.current = null
        setIsOpen(false)
      }
      setCoordinationVersion((value) => value + 1)
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [accountId, releaseActive])

  const retryDeniedEmail = useCallback(async () => {
    if (!accountId) return
    setPreferenceError(false)
    try {
      await saveEmailPreference()
      recordCompleted(accountId)
    } catch {
      setPreferenceError(true)
    }
  }, [accountId, saveEmailPreference])

  async function enable() {
    setIsEnabling(true)
    try {
      await push.enable()
      finishAndClose()
    } catch {
      const permissionDenied =
        push.permission === 'denied' ||
        (typeof Notification !== 'undefined' &&
          Notification.permission === 'denied')
      if (permissionDenied) {
        setResult('denied')
        await retryDeniedEmail()
      } else {
        setResult('failed')
        if (accountId) recordCompleted(accountId)
      }
    } finally {
      setIsEnabling(false)
    }
  }

  if (!eligible || !isOpen || !accountId) return null

  return (
    <ResponsiveDialog
      open={isOpen}
      onOpenChange={(next) => {
        if (next) return
        if (preferenceError) {
          closeResult()
          return
        }
        if (result) closeResult()
        else void chooseEmail()
      }}
    >
      <ResponsiveDialogContent
        className="max-w-md"
        data-testid="push-notification-onboarding"
      >
        <ResponsiveDialogHeader>
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary sm:mx-0">
            <BellRing className="h-6 w-6" aria-hidden="true" />
          </div>
          <ResponsiveDialogTitle>
            {result === 'denied'
              ? t('PushOnboarding.deniedTitle')
              : result === 'failed'
                ? t('PushOnboarding.failedTitle')
                : t('PushOnboarding.title')}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {result === 'denied'
              ? t('PushOnboarding.deniedDescription')
              : result === 'failed'
                ? t('PushOnboarding.failedDescription')
                : t('PushOnboarding.description')}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        {result ? (
          <div className="flex flex-col gap-3 text-sm">
            <div className="flex items-start gap-3 rounded-lg border bg-muted/30 p-3">
              <Mail
                className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                aria-hidden="true"
              />
              <p>{t('PushOnboarding.emailUsage')}</p>
            </div>
            <p className="text-xs text-muted-foreground">
              {t('PushOnboarding.settingsHint')}
            </p>
            {preferenceError ? (
              <p className="text-sm text-destructive" role="alert">
                {t('AccountSettings.notifications.saveError')}
              </p>
            ) : null}
            <ResponsiveDialogFooter className="mt-2">
              <Button
                type="button"
                onClick={() =>
                  preferenceError ? void retryDeniedEmail() : closeResult()
                }
                disabled={savePreferences.isPending}
              >
                {preferenceError
                  ? t('AccountSettings.notifications.retry')
                  : t('PushOnboarding.done')}
              </Button>
            </ResponsiveDialogFooter>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-3 text-sm">
              <div className="flex items-start gap-3 rounded-lg border bg-muted/30 p-3">
                <Smartphone
                  className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                  aria-hidden="true"
                />
                <p>{t('PushOnboarding.pushBenefit')}</p>
              </div>
              <div className="flex items-start gap-3 rounded-lg border bg-muted/30 p-3">
                <Mail
                  className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                  aria-hidden="true"
                />
                <p>{t('PushOnboarding.emailFallback')}</p>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('PushOnboarding.settingsHint')}
              </p>
            </div>
            <ResponsiveDialogFooter className="mt-2 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => void chooseEmail()}
                disabled={isEnabling || savePreferences.isPending}
              >
                {preferenceError
                  ? t('AccountSettings.notifications.retry')
                  : t('PushOnboarding.useEmail')}
              </Button>
              <Button
                type="button"
                onClick={() => void enable()}
                disabled={isEnabling || savePreferences.isPending}
              >
                {isEnabling
                  ? t('PushOnboarding.enabling')
                  : t('PushOnboarding.enable')}
              </Button>
            </ResponsiveDialogFooter>
            {preferenceError ? (
              <p className="text-sm text-destructive" role="alert">
                {t('AccountSettings.notifications.saveError')}
              </p>
            ) : null}
          </>
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}

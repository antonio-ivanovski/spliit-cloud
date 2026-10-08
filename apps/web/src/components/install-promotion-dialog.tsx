import { AppWindowMac, Menu, Share, Smartphone } from 'lucide-react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { useStartupTimeZoneCheck } from '@/components/account-preferences-sync'
import { isPushOnboardingActive } from '@/components/push-notification-onboarding'
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
import {
  INSTALL_PROMPT_TIMING,
  isPromotionBlockedByWork,
  useInstallPrompt,
} from '@/lib/use-install-prompt'

/**
 * Auto-opening promotion dialog that nudges the user to install Spliit Cloud as
 * a PWA. Replaces the previous toolbar icon button so the affordance is visible
 * on every browser that supports installation, not just Chromium (which alone
 * fires `beforeinstallprompt`).
 *
 * Browser-adaptive content: - Chrome / Edge / Brave / Samsung / Arc (Chromium,
 * native install): primary "Install" button that triggers
 * `deferredPrompt.prompt()`. - iOS Safari (and every WebKit-based iOS browser):
 * inline 3-step Share → Add to Home Screen instructions; no install button
 * (programmatic install is not possible on iOS). - Firefox on Android: inline
 * 2-step menu (⋮) → Install instructions; no install button (Firefox does not
 * expose `beforeinstallprompt`). - Other browsers (Firefox desktop, Safari
 * desktop, etc.): renders nothing.
 *
 * Persistence via localStorage: - "Not now" sets a 7-day cooldown. - "Don't ask
 * again" sets a permanent dismissal flag (auto-opened prompts only; explicit
 * menu opens hide it because the user just asked). - Successful install
 * (`appinstalled`) clears both flags.
 *
 * Esc / backdrop close count as "Not now" so an accidental dismissal does not
 * silently suppress the prompt forever.
 */
export function InstallPromotionDialog(props?: {
  /**
   * Test seam: fresh service instance per test. Production omits it and
   * resolves the page bundle (single capture owner, started in main.tsx).
   */
  readonly service?: Parameters<typeof useInstallPrompt>[0]
}) {
  const { t } = useTranslation()
  const {
    browserSupport,
    readyToShow,
    isOpen,
    manualOpen,
    open,
    remindLater,
    dismiss,
    install,
  } = useInstallPrompt(props?.service)
  const timeZoneCheck = useStartupTimeZoneCheck()

  // Auto-open after a successful sign-in, once the page has settled: 10s of
  // user quiet, a visible document, no unfinished-work blockers, and no other
  // onboarding dialog. Redirect landings (OAuth/magic link) satisfy the
  // redirect-finish rule because eligibility is only set across the completed
  // round-trip. The timer re-arms on every `readyToShow` transition.
  useEffect(() => {
    if (
      !readyToShow ||
      isOpen ||
      !timeZoneCheck.checked ||
      timeZoneCheck.promptActive
    )
      return
    let timer: number | undefined
    let lastActivity = Date.now()
    const onActivity = () => {
      lastActivity = Date.now()
    }
    const activityEvents = [
      'pointerdown',
      'keydown',
      'touchstart',
      'scroll',
    ] as const
    for (const type of activityEvents) {
      window.addEventListener(type, onActivity, { passive: true })
    }
    const attempt = () => {
      if (isPushOnboardingActive()) {
        timer = window.setTimeout(attempt, 500)
        return
      }
      if (document.hidden) return
      if (isPromotionBlockedByWork()) {
        timer = window.setTimeout(attempt, 5000)
        return
      }
      const quietFor = Date.now() - lastActivity
      if (quietFor < INSTALL_PROMPT_TIMING.AUTO_OPEN_QUIET_MS) {
        timer = window.setTimeout(
          attempt,
          INSTALL_PROMPT_TIMING.AUTO_OPEN_QUIET_MS - quietFor,
        )
        return
      }
      open()
    }
    const onVisible = () => {
      if (!document.hidden) attempt()
    }
    document.addEventListener('visibilitychange', onVisible)
    timer = window.setTimeout(attempt, INSTALL_PROMPT_TIMING.AUTO_OPEN_QUIET_MS)
    return () => {
      if (timer !== undefined) window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
      for (const type of activityEvents) {
        window.removeEventListener(type, onActivity)
      }
    }
  }, [
    readyToShow,
    isOpen,
    open,
    timeZoneCheck.checked,
    timeZoneCheck.promptActive,
  ])

  if (browserSupport === 'unsupported') return null

  return (
    <ResponsiveDialog
      open={isOpen}
      onOpenChange={(next) => {
        if (!next) {
          // Treat Esc / backdrop dismissals as "not now" so an
          // accidental close does not silence the prompt forever.
          remindLater()
        }
      }}
    >
      <ResponsiveDialogContent
        className="max-w-md"
        data-testid="install-promotion-dialog"
        // Don't autofocus the Install button on open — the focus ring looks
        // broken on a promo dialog and Enter would fire the native prompt.
        initialFocus={() => null}
      >
        {browserSupport === 'native-install' && <ChromeHeader />}
        {browserSupport === 'ios-instructions' && <IosContent />}
        {browserSupport === 'firefox-android-instructions' && (
          <FirefoxContent />
        )}
        {browserSupport === 'safari-desktop-instructions' && <SafariContent />}

        <ResponsiveDialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:items-center">
          {!manualOpen && (
            <Button
              type="button"
              variant="ghost"
              onClick={dismiss}
              data-testid="install-promotion-dismiss"
              className="w-full sm:mr-auto sm:w-auto sm:justify-start"
            >
              {t('InstallPromotion.dismiss')}
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={remindLater}
            data-testid="install-promotion-remind-later"
            className={
              manualOpen ? 'w-full sm:mr-auto sm:w-auto' : 'w-full sm:w-auto'
            }
          >
            {t('InstallPromotion.remindLater')}
          </Button>
          {browserSupport === 'native-install' && (
            <Button
              type="button"
              onClick={() => {
                void install().then((outcome) => {
                  // A native dismissal cools down like "Not now".
                  if (outcome === 'dismissed') remindLater()
                })
              }}
              data-testid="install-promotion-install"
              className="w-full sm:w-auto"
            >
              {t('InstallPromotion.install')}
            </Button>
          )}
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}

function ChromeHeader() {
  const { t } = useTranslation()
  return (
    <ResponsiveDialogHeader>
      <ResponsiveDialogTitle>
        {t('InstallPromotion.chrome.title')}
      </ResponsiveDialogTitle>
      <ResponsiveDialogDescription>
        {t('InstallPromotion.chrome.description')}
      </ResponsiveDialogDescription>
    </ResponsiveDialogHeader>
  )
}

function IosContent() {
  const { t } = useTranslation()
  return (
    <>
      <ResponsiveDialogHeader>
        <ResponsiveDialogTitle>
          {t('InstallPromotion.ios.title')}
        </ResponsiveDialogTitle>
        <ResponsiveDialogDescription>
          {t('InstallPromotion.ios.description')}
        </ResponsiveDialogDescription>
      </ResponsiveDialogHeader>
      <ResponsiveDialogBody>
        <ol className="flex flex-col gap-3 text-sm">
          <InstallStep n={1} icon={<Share className="h-4 w-4 text-primary" />}>
            {t('InstallPromotion.ios.step1')}
          </InstallStep>
          <InstallStep
            n={2}
            icon={<Smartphone className="h-4 w-4 text-primary" />}
          >
            {t('InstallPromotion.ios.step2')}
          </InstallStep>
          <InstallStep n={3}>{t('InstallPromotion.ios.step3')}</InstallStep>
        </ol>
      </ResponsiveDialogBody>
    </>
  )
}

function FirefoxContent() {
  const { t } = useTranslation()
  return (
    <>
      <ResponsiveDialogHeader>
        <ResponsiveDialogTitle>
          {t('InstallPromotion.firefox.title')}
        </ResponsiveDialogTitle>
        <ResponsiveDialogDescription>
          {t('InstallPromotion.firefox.description')}
        </ResponsiveDialogDescription>
      </ResponsiveDialogHeader>
      <ResponsiveDialogBody>
        <ol className="flex flex-col gap-3 text-sm">
          <InstallStep n={1} icon={<Menu className="h-4 w-4 text-primary" />}>
            {t('InstallPromotion.firefox.step1')}
          </InstallStep>
          <InstallStep n={2}>{t('InstallPromotion.firefox.step2')}</InstallStep>
        </ol>
      </ResponsiveDialogBody>
    </>
  )
}

function SafariContent() {
  const { t } = useTranslation()
  return (
    <>
      <ResponsiveDialogHeader>
        <ResponsiveDialogTitle>
          {t('InstallPromotion.safari.title')}
        </ResponsiveDialogTitle>
        <ResponsiveDialogDescription>
          {t('InstallPromotion.safari.description')}
        </ResponsiveDialogDescription>
      </ResponsiveDialogHeader>
      <ResponsiveDialogBody>
        <ol className="flex flex-col gap-3 text-sm">
          <InstallStep
            n={1}
            icon={<AppWindowMac className="h-4 w-4 text-primary" />}
          >
            {t('InstallPromotion.safari.step1')}
          </InstallStep>
          <InstallStep n={2}>{t('InstallPromotion.safari.step2')}</InstallStep>
        </ol>
      </ResponsiveDialogBody>
    </>
  )
}

function InstallStep({
  n,
  icon,
  children,
}: {
  n: number
  icon?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <li className="flex items-start gap-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
        {n}
      </span>
      <div className="flex items-start gap-2 pt-1">
        <span>{children}</span>
        {icon}
      </div>
    </li>
  )
}

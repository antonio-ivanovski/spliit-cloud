import { Menu, Share, Smartphone } from 'lucide-react'
import { useEffect } from 'react'
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
import {
  INSTALL_PROMPT_TIMING,
  useInstallPrompt,
} from '@/lib/use-install-prompt'

/**
 * Auto-opening promotion dialog that nudges the user to install Spliit Cloud
 * as a PWA. Replaces the previous toolbar icon button so the affordance is
 * visible on every browser that supports installation, not just Chromium
 * (which alone fires `beforeinstallprompt`).
 *
 * Browser-adaptive content:
 * - Chrome / Edge / Brave / Samsung / Arc (Chromium, native install):
 *   primary "Install" button that triggers `deferredPrompt.prompt()`.
 * - iOS Safari (and every WebKit-based iOS browser): inline 3-step Share →
 *   Add to Home Screen instructions; no install button (programmatic install
 *   is not possible on iOS).
 * - Firefox on Android: inline 2-step menu (⋮) → Install instructions; no
 *   install button (Firefox does not expose `beforeinstallprompt`).
 * - Other browsers (Firefox desktop, Safari desktop, etc.): renders nothing.
 *
 * Persistence via localStorage:
 * - "Remind me later" sets a 24h cooldown.
 * - "Don't show again" sets a permanent dismissal flag.
 * - Successful install (`appinstalled`) clears both flags.
 *
 * Esc / backdrop close count as "Remind me later" so an accidental dismissal
 * does not silently suppress the prompt forever.
 */
export function InstallPromotionDialog() {
  const { t } = useTranslation()
  const {
    browserSupport,
    readyToShow,
    isOpen,
    open,
    close,
    remindLater,
    dismiss,
    install,
  } = useInstallPrompt()

  // Auto-open the dialog a short moment after every gate flips on, so the
  // user is greeted by it once the page has settled and the PWA install
  // signal has fired. The timer is re-armed on every `readyToShow` transition.
  useEffect(() => {
    if (!readyToShow || isOpen) return
    const timer = window.setTimeout(
      open,
      INSTALL_PROMPT_TIMING.AUTO_OPEN_DELAY_MS,
    )
    return () => window.clearTimeout(timer)
  }, [readyToShow, isOpen, open])

  if (browserSupport === 'unsupported') return null

  return (
    <ResponsiveDialog
      open={isOpen}
      onOpenChange={(next) => {
        if (!next) {
          // Treat Esc / backdrop dismissals as "remind me later" so an
          // accidental close does not silence the prompt forever.
          remindLater()
        }
      }}
    >
      <ResponsiveDialogContent
        className="max-w-md"
        data-testid="install-promotion-dialog"
      >
        {browserSupport === 'native-install' && (
          <ChromeContent onInstall={install} />
        )}
        {browserSupport === 'ios-instructions' && <IosContent />}
        {browserSupport === 'firefox-android-instructions' && (
          <FirefoxContent />
        )}

        <ResponsiveDialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="ghost"
            onClick={dismiss}
            data-testid="install-promotion-dismiss"
          >
            {t('InstallPromotion.dismiss')}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={remindLater}
            data-testid="install-promotion-remind-later"
          >
            {t('InstallPromotion.remindLater')}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}

function ChromeContent({ onInstall }: { onInstall: () => Promise<unknown> }) {
  const { t } = useTranslation()
  return (
    <>
      <ResponsiveDialogHeader>
        <ResponsiveDialogTitle>
          {t('InstallPromotion.chrome.title')}
        </ResponsiveDialogTitle>
        <ResponsiveDialogDescription>
          {t('InstallPromotion.chrome.description')}
        </ResponsiveDialogDescription>
      </ResponsiveDialogHeader>
      <ResponsiveDialogFooter className="-mt-2 flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          onClick={() => {
            void onInstall()
          }}
          data-testid="install-promotion-install"
          className="w-full sm:w-auto"
        >
          {t('InstallPromotion.install')}
        </Button>
      </ResponsiveDialogFooter>
    </>
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
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold">
        {n}
      </span>
      <div className="flex items-start gap-2 pt-1">
        <span>{children}</span>
        {icon}
      </div>
    </li>
  )
}

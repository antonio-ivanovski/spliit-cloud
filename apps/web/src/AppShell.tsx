import { Outlet, Link, useLocation } from '@tanstack/react-router'
import { Suspense, type ReactNode, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { AccountMenu } from '@/components/account-menu'
import { AccountPreferencesSync } from '@/components/account-preferences-sync'
import {
  AmbientAccentProvider,
  AmbientBackdrop,
} from '@/components/ambient-backdrop'
import Image from '@/components/app-image'
import { CurrencyConverterButton } from '@/components/currency-converter/currency-converter'
import { InstallPromotionDialog } from '@/components/install-promotion-dialog'
import { LocaleSwitcher } from '@/components/locale-switcher'
import { MascotProvider } from '@/components/mascot/mascot-context'
import { MascotHost } from '@/components/mascot/mascot-host'
import { MobileAppBar, MobileAppHeaderActions } from '@/components/mobile-shell'
import { OfflineBanner } from '@/components/offline-banner'
import { ProfileGate } from '@/components/profile-gate'
import { ProgressBar } from '@/components/progress-bar'
import { PushNotificationOnboarding } from '@/components/push-notification-onboarding'
import {
  PwaUpdateCompositionGuard,
  PwaUpdateMutationGuard,
  PwaUpdateNavigationGuard,
} from '@/components/pwa-update-guards'
import { PwaUpdatePill } from '@/components/pwa-update-pill'
import { ThemeProvider } from '@/components/theme-provider'
import { ThemeToggle } from '@/components/theme-toggle'
import { Toaster } from '@/components/ui/toaster'
import { I18nProvider } from '@/i18n/react'
import { isFocusedMobilePath, isMobileGroupTabPath } from '@/lib/mobile-nav'
import { OfflineProvider, OfflineSyncHost } from '@/lib/offline/provider'
import { markPwaUpdateProtectionInitialized } from '@/lib/pwa-update-blockers'
import { TRPCProvider } from '@/trpc/client'

import { MergeDeviceSavedViews } from './app/groups/merge-device-saved-views'
import { ArtFooter } from './components/footer/ArtFooter'

function AccountPreferencesBoundary({
  children,
  isAuthRoute,
}: {
  children: ReactNode
  isAuthRoute: boolean
}) {
  return isAuthRoute ? (
    <>{children}</>
  ) : (
    <AccountPreferencesSync>{children}</AccountPreferencesSync>
  )
}

function Content() {
  const { t } = useTranslation()
  const pathname = useLocation({ select: (location) => location.pathname })
  const isAuthRoute = pathname.startsWith('/auth/')
  const focusedMobileRoute = isFocusedMobilePath(pathname)
  const groupTabMobileRoute = isMobileGroupTabPath(pathname)
  const hideMobileFooter =
    focusedMobileRoute ||
    pathname.startsWith('/groups/') ||
    pathname.startsWith('/expenses') ||
    pathname.startsWith('/friends/') ||
    pathname.startsWith('/account/')
  const showAmbientBackdrop =
    pathname === '/' ||
    pathname.startsWith('/expenses') ||
    pathname.startsWith('/groups') ||
    pathname.startsWith('/friends') ||
    pathname.startsWith('/account')

  return (
    <TRPCProvider>
      <OfflineProvider>
        <OfflineSyncHost />
        <MergeDeviceSavedViews />
        <PwaUpdateMutationGuard />
        <PwaUpdateCompositionGuard />
        <PwaUpdateNavigationGuard />
        <AccountPreferencesBoundary isAuthRoute={isAuthRoute}>
          <MascotProvider>
            <div className="app-shell relative isolate flex flex-col overflow-x-clip">
              {showAmbientBackdrop && <AmbientBackdrop />}
              <header
                data-app-header
                className="fixed inset-x-0 top-0 z-50 hidden h-16 justify-between border-b bg-white/50 p-2 backdrop-blur-xs sm:flex dark:bg-gray-950/50"
              >
                <Link
                  className="flex items-center gap-2 transition-transform hover:scale-105"
                  to="/"
                >
                  <div className="flex items-center gap-2" aria-label="Spliit">
                    <Image
                      src="/logo-with-text.svg"
                      className="m-1 h-[45px] w-auto"
                      width={(45 * 522) / 180}
                      height={45}
                      alt="Spliit"
                    />
                  </div>
                </Link>
                <nav aria-label={t('Header.menu')} className="flex">
                  <ul className="flex items-center gap-1 text-sm">
                    <li>
                      <CurrencyConverterButton />
                    </li>
                    <li>
                      <LocaleSwitcher />
                    </li>
                    <li>
                      <ThemeToggle />
                    </li>
                    <li>
                      <AccountMenu />
                    </li>
                  </ul>
                </nav>
              </header>

              {focusedMobileRoute ? (
                <div className="sm:hidden">
                  <MobileAppBar />
                </div>
              ) : groupTabMobileRoute ? null : (
                <div
                  data-app-header
                  className="fixed inset-x-0 top-0 z-50 flex h-(--app-header-height) items-center justify-between border-b bg-white/90 px-3 app-header-inset backdrop-blur sm:hidden dark:bg-gray-950/90"
                >
                  <Link
                    to="/"
                    aria-label="Spliit"
                    className="flex items-center"
                  >
                    <Image
                      src="/logo-with-text.svg"
                      className="h-9 w-auto"
                      width={(36 * 522) / 180}
                      height={36}
                      alt="Spliit"
                    />
                  </Link>
                  <MobileAppHeaderActions />
                </div>
              )}

              <PwaUpdatePill />
              {isAuthRoute ? null : <PushNotificationOnboarding />}
              {isAuthRoute ? null : <InstallPromotionDialog />}

              <div className="relative z-20 flex flex-1 flex-col pt-(--app-header-height)">
                <OfflineBanner />
                <ProfileGate>
                  <Outlet />
                </ProfileGate>
              </div>

              <ArtFooter hiddenOnMobile={hideMobileFooter} />
            </div>
            <MascotHost />
            <Toaster />
          </MascotProvider>
        </AccountPreferencesBoundary>
      </OfflineProvider>
    </TRPCProvider>
  )
}

export function AppShell() {
  useEffect(() => {
    document.documentElement.removeAttribute('data-pwa-update-restart')
    // Producers register via effects on mount; only after this commit can an
    // empty blocker registry be read as "clean".
    markPwaUpdateProtectionInitialized()
  }, [])

  return (
    <I18nProvider>
      <ThemeProvider>
        <Suspense>
          <ProgressBar />
        </Suspense>
        <AmbientAccentProvider>
          <Content />
        </AmbientAccentProvider>
      </ThemeProvider>
    </I18nProvider>
  )
}

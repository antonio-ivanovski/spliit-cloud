/* oxlint-disable jsx-a11y/anchor-has-content, jsx-a11y/control-has-associated-label -- Trans injects the contributor link's accessible text at runtime. */
import { Outlet, useLocation } from '@tanstack/react-router'
import { Suspense } from 'react'
import { Trans, useTranslation } from 'react-i18next'

import { AccountMenu } from '@/components/account-menu'
import { AccountPreferencesSync } from '@/components/account-preferences-sync'
import Image from '@/components/app-image'
import { CurrencyConverterButton } from '@/components/currency-converter/currency-converter'
import { InstallPromotionDialog } from '@/components/install-promotion-dialog'
import Link from '@/components/link'
import { LocaleSwitcher } from '@/components/locale-switcher'
import { MobileAppBar } from '@/components/mobile-shell'
import { OfflineBanner } from '@/components/offline-banner'
import { ProfileGate } from '@/components/profile-gate'
import { ProgressBar } from '@/components/progress-bar'
import { PushNotificationOnboarding } from '@/components/push-notification-onboarding'
import { ThemeProvider } from '@/components/theme-provider'
import { ThemeToggle } from '@/components/theme-toggle'
import { Button } from '@/components/ui/button'
import { Toaster } from '@/components/ui/toaster'
import { I18nProvider } from '@/i18n/react'
import { isFocusedMobilePath } from '@/lib/mobile-nav'
import { TRPCProvider } from '@/trpc/client'

import githubSvg from './components/auth/github.svg'

function Content() {
  const { t } = useTranslation()
  const pathname = useLocation({ select: (location) => location.pathname })
  const focusedMobileRoute = isFocusedMobilePath(pathname)
  const showAmbientBackdrop =
    pathname === '/' ||
    pathname.startsWith('/expenses') ||
    pathname.startsWith('/groups') ||
    pathname.startsWith('/friends') ||
    pathname.startsWith('/account')

  return (
    <TRPCProvider>
      <AccountPreferencesSync>
        <div className="app-shell relative isolate flex min-h-screen flex-col overflow-x-clip">
          {showAmbientBackdrop && (
            <div className="ambient-backdrop" aria-hidden="true">
              <span className="ambient-backdrop__orb ambient-backdrop__orb--emerald" />
              <span className="ambient-backdrop__orb ambient-backdrop__orb--coral" />
            </div>
          )}
          <header className="fixed inset-x-0 top-0 z-50 hidden h-16 justify-between border-b bg-white/50 p-2 backdrop-blur-xs sm:flex dark:bg-gray-950/50">
            <Link
              className="flex items-center gap-2 transition-transform hover:scale-105"
              href="/"
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
            <div className="sm:hidden [&>header]:pe-12">
              <MobileAppBar />
              <div className="fixed end-2 top-0 z-50 flex h-(--app-header-height) items-center gap-1">
                <CurrencyConverterButton />
                <LocaleSwitcher />
              </div>
            </div>
          ) : (
            <div className="fixed inset-x-0 top-0 z-50 flex h-(--app-header-height) items-center justify-between border-b bg-white/90 px-3 backdrop-blur sm:hidden dark:bg-gray-950/90">
              <Link href="/" aria-label="Spliit" className="flex items-center">
                <Image
                  src="/logo-with-text.svg"
                  className="h-9 w-auto"
                  width={(36 * 522) / 180}
                  height={36}
                  alt="Spliit"
                />
              </Link>
              <div className="flex items-center gap-1">
                <CurrencyConverterButton />
                <LocaleSwitcher />
                <ThemeToggle />
                <AccountMenu />
              </div>
            </div>
          )}

          <OfflineBanner />
          <PushNotificationOnboarding />
          <InstallPromotionDialog />

          <div className="relative z-20 flex flex-1 flex-col pt-(--app-header-height)">
            <ProfileGate>
              <Outlet />
            </ProfileGate>
          </div>

          <footer
            className={`${focusedMobileRoute ? 'hidden sm:flex' : 'flex'} relative z-10 mt-8 flex-col gap-4 border-t bg-slate-50 p-6 text-xs sm:mt-16 sm:flex-row sm:justify-between sm:p-8 sm:text-sm md:mt-32 md:p-16 md:text-base dark:bg-card [&_a]:underline`}
          >
            <div className="flex flex-col space-y-2">
              <div className="flex items-center space-x-2 text-base font-semibold sm:text-lg">
                <Link className="flex items-center gap-2" href="/">
                  <Image
                    src="/logo-with-text.svg"
                    className="m-1 h-[45px] w-auto"
                    width={(45 * 522) / 180}
                    height={45}
                    alt="Spliit Cloud"
                  />
                </Link>
              </div>
              <div className="space-y a--no-underline-text-white flex flex-col">
                <span>{t('Footer.madeIn')}</span>
                <span>
                  <Trans
                    i18nKey="Footer.builtBy"
                    components={{
                      source: (
                        <a
                          href="https://github.com/antonio-ivanovski/spliit-cloud/graphs/contributors"
                          target="_blank"
                          rel="noopener noreferrer"
                        />
                      ),
                    }}
                  />
                </span>
                <nav
                  aria-label={t('Footer.legalNavigation')}
                  className="flex flex-wrap gap-x-3 gap-y-1"
                >
                  <Link href="/privacy">{t('Footer.privacy')}</Link>
                  <Link href="/terms">{t('Footer.terms')}</Link>
                  <Link href="/imprint">{t('Footer.imprint')}</Link>
                  <Link href="/feedback">{t('Feedback.navigationLabel')}</Link>
                </nav>
              </div>
            </div>
            <Button
              variant="secondary"
              size="sm"
              render={
                <Link href="https://github.com/antonio-ivanovski/spliit-cloud" />
              }
            >
              <img src={githubSvg} alt="" className="me-2 h-4 w-4" />
              GitHub
            </Button>
          </footer>
        </div>
        <Toaster />
      </AccountPreferencesSync>
    </TRPCProvider>
  )
}

export function AppShell() {
  return (
    <I18nProvider>
      <ThemeProvider>
        <Suspense>
          <ProgressBar />
        </Suspense>
        <Content />
      </ThemeProvider>
    </I18nProvider>
  )
}

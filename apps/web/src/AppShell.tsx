import { AccountMenu } from '@/components/account-menu'
import Image from '@/components/app-image'
import { InstallPromotionDialog } from '@/components/install-promotion-dialog'
import Link from '@/components/link'
import { LocaleSwitcher } from '@/components/locale-switcher'
import { MobileAppBar } from '@/components/mobile-shell'
import { OfflineBanner } from '@/components/offline-banner'
import { ProfileGate } from '@/components/profile-gate'
import { ProgressBar } from '@/components/progress-bar'
import { ThemeProvider } from '@/components/theme-provider'
import { ThemeToggle } from '@/components/theme-toggle'
import { Button } from '@/components/ui/button'
import { Toaster } from '@/components/ui/toaster'
import { I18nProvider } from '@/i18n/react'
import { isFocusedMobilePath } from '@/lib/mobile-nav'
import { TRPCProvider } from '@/trpc/client'
import { Outlet, useLocation } from '@tanstack/react-router'
import { Suspense } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import githubSvg from './components/auth/github.svg'

function Content() {
  const { t } = useTranslation()
  const pathname = useLocation({ select: (location) => location.pathname })
  const focusedMobileRoute = isFocusedMobilePath(pathname)

  return (
    <TRPCProvider>
      <div className="app-shell flex min-h-screen flex-col">
        <header className="fixed inset-x-0 top-0 z-50 hidden h-16 justify-between border-b bg-white/50 p-2 backdrop-blur-xs dark:bg-gray-950/50 sm:flex">
          <Link
            className="flex items-center gap-2 hover:scale-105 transition-transform"
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
            <ul className="flex items-center text-sm gap-1">
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
            <div className="fixed end-2 top-0 z-50 flex h-(--app-header-height) items-center">
              <LocaleSwitcher />
            </div>
          </div>
        ) : (
          <div className="fixed inset-x-0 top-0 z-50 flex h-(--app-header-height) items-center justify-between border-b bg-white/90 px-3 backdrop-blur dark:bg-gray-950/90 sm:hidden">
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
              <LocaleSwitcher />
              <ThemeToggle />
              <AccountMenu />
            </div>
          </div>
        )}

        <OfflineBanner />
        <InstallPromotionDialog />

        <div className="flex flex-1 flex-col pt-(--app-header-height)">
          <ProfileGate>
            <Outlet />
          </ProfileGate>
        </div>

        <footer
          className={`${focusedMobileRoute ? 'hidden sm:flex' : 'flex'} sm:p-8 md:p-16 sm:mt-16 sm:text-sm md:text-base md:mt-32 bg-slate-50 dark:bg-card border-t p-6 mt-8 flex-col sm:flex-row sm:justify-between gap-4 text-xs [&_a]:underline`}
        >
          <div className="flex flex-col space-y-2">
            <div className="sm:text-lg font-semibold text-base flex space-x-2 items-center">
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
            <div className="flex flex-col space-y a--no-underline-text-white">
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
              </nav>
            </div>
          </div>
          <Button asChild variant="secondary" size="sm">
            <Link href="https://github.com/antonio-ivanovski/spliit-cloud">
              <img src={githubSvg} alt="" className="w-4 h-4 mr-2" />
              GitHub
            </Link>
          </Button>
        </footer>
      </div>
      <Toaster />
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

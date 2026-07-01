import { AccountMenu } from '@/components/account-menu'
import Image from '@/components/app-image'
import Link from '@/components/link'
import { LocaleSwitcher } from '@/components/locale-switcher'
import { ProgressBar } from '@/components/progress-bar'
import { ThemeProvider } from '@/components/theme-provider'
import { ThemeToggle } from '@/components/theme-toggle'
import { Button } from '@/components/ui/button'
import { Toaster } from '@/components/ui/toaster'
import { I18nProvider } from '@/i18n/react'
import { TRPCProvider } from '@/trpc/client'
import { Outlet } from '@tanstack/react-router'
import { Suspense } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import githubSvg from './components/auth/github.svg'

function Content() {
  const { t } = useTranslation()

  return (
    <TRPCProvider>
      <div className="min-h-screen flex flex-col">
        <header className="fixed top-0 left-0 right-0 h-16 flex justify-between bg-white dark:bg-gray-950 bg-opacity-50 dark:bg-opacity-50 p-2 border-b backdrop-blur-xs z-50">
          <Link
            className="flex items-center gap-2 hover:scale-105 transition-transform"
            href="/"
          >
            <h1 className="flex items-center gap-2">
              <Image
                src="/logo-with-text.svg"
                className="m-1 h-[45px] w-auto"
                width={(45 * 522) / 180}
                height={45}
                alt="Spliit"
              />
            </h1>
          </Link>
          <div role="navigation" aria-label="Menu" className="flex">
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
          </div>
        </header>

        <div className="pt-16 flex-1 flex flex-col">
          <Outlet />
        </div>

        <footer className="sm:p-8 md:p-16 sm:mt-16 sm:text-sm md:text-base md:mt-32 bg-slate-50 dark:bg-card border-t p-6 mt-8 flex flex-col sm:flex-row sm:justify-between gap-4 text-xs [&_a]:underline">
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
                        rel="noopener"
                      />
                    ),
                  }}
                />
              </span>
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

import { Link, Outlet } from '@tanstack/react-router'
import { Wallet } from 'lucide-react'

import { useDocumentTitle } from '@/components/document-title'
import { PageInset, PageShell } from '@/components/layout/page-shell'
import { RequireAuth } from '@/components/require-auth'
import { Card, CardContent } from '@/components/ui/card'

import { usePersonalFeature } from './api'
import { usePersonalTranslation } from './personal-i18n'
import { PersonalNav } from './personal-nav'

function PersonalDisabled() {
  const { t } = usePersonalTranslation()
  useDocumentTitle(t('disabled.title'))
  return (
    <PageShell className="flex-col gap-4 py-4 sm:py-6">
      <PageInset>
        <Card>
          <CardContent
            spacing="standalone"
            className="flex flex-col items-center gap-3 py-10 text-center"
          >
            <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Wallet className="size-6" aria-hidden="true" />
            </span>
            <h1 className="font-semibold">{t('disabled.title')}</h1>
            <p className="max-w-sm text-sm text-muted-foreground">
              {t('disabled.description')}
            </p>
            <Link
              to="/"
              className="text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              {t('disabled.backHome')}
            </Link>
          </CardContent>
        </Card>
      </PageInset>
    </PageShell>
  )
}

export function PersonalLayoutClient() {
  const { t } = usePersonalTranslation()
  const { enabled, isLoading } = usePersonalFeature()
  useDocumentTitle(t('title'))

  if (isLoading) {
    return (
      <PageShell
        className="flex-col gap-4 py-4 sm:py-6"
        aria-busy="true"
        aria-label={t('loading')}
      >
        <div className="flex gap-4">
          <div className="hidden w-56 shrink-0 md:block">
            <div className="h-64 animate-pulse rounded-xl bg-muted" />
          </div>
          <div className="min-w-0 flex-1 space-y-4">
            <div className="h-40 animate-pulse rounded-xl bg-muted" />
            <div className="h-64 animate-pulse rounded-xl bg-muted" />
          </div>
        </div>
      </PageShell>
    )
  }

  if (!enabled) return <PersonalDisabled />

  return (
    <PageShell className="flex-col gap-4 py-4 pb-24 sm:gap-6 sm:py-6 md:pb-6">
      <div className="flex w-full items-start gap-6">
        <PersonalNav />
        <div className="min-w-0 flex-1">
          <Outlet />
        </div>
      </div>
    </PageShell>
  )
}

export default function PersonalLayoutPage() {
  return (
    <RequireAuth>
      <PersonalLayoutClient />
    </RequireAuth>
  )
}

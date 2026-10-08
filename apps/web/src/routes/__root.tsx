import { createRootRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { AppShell } from '@/AppShell'
import { useDocumentTitle } from '@/components/document-title'
import { NotFoundPage } from '@/components/not-found-page'

function GlobalNotFound() {
  const { t } = useTranslation()
  useDocumentTitle(t('NotFoundPage.title'))
  return (
    <main className="flex flex-1 flex-col">
      <NotFoundPage variant="page" />
    </main>
  )
}

function GlobalError({ reset }: { error: unknown; reset: () => void }) {
  const { t } = useTranslation()
  useDocumentTitle(t('NotFoundPage.errorTitle'))
  return (
    <main className="flex flex-1 flex-col">
      <NotFoundPage
        variant="page"
        title={t('NotFoundPage.errorTitle')}
        description={t('NotFoundPage.errorDescription')}
        onRetry={reset}
        showBackButton={false}
      />
    </main>
  )
}

export const Route = createRootRoute({
  component: AppShell,
  notFoundComponent: GlobalNotFound,
  errorComponent: GlobalError,
})

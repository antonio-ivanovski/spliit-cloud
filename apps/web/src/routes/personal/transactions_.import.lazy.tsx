import { createLazyFileRoute } from '@tanstack/react-router'
import { Suspense } from 'react'

import { PersonalImportPage } from '@/app/personal/import/page-import'

export const Route = createLazyFileRoute('/personal/transactions_/import')({
  component: () => (
    <Suspense>
      <PersonalImportPage />
    </Suspense>
  ),
})

import { createLazyFileRoute } from '@tanstack/react-router'
import { Suspense } from 'react'

import { PersonalCategorizePage } from '@/app/personal/categorize/page-categorize'

export const Route = createLazyFileRoute('/personal/transactions_/categorize')({
  component: () => (
    <Suspense>
      <PersonalCategorizePage />
    </Suspense>
  ),
})

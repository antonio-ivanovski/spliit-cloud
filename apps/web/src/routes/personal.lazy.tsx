import { createLazyFileRoute } from '@tanstack/react-router'
import { Suspense } from 'react'

import PersonalLayoutPage from '@/app/personal/layout'

export const Route = createLazyFileRoute('/personal')({
  component: () => (
    <Suspense>
      <PersonalLayoutPage />
    </Suspense>
  ),
})

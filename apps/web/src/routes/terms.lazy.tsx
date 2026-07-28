import { createLazyFileRoute } from '@tanstack/react-router'

import TermsPage from '@/app/terms'

export const Route = createLazyFileRoute('/terms')({
  component: TermsPage,
})

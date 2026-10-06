import { createLazyFileRoute } from '@tanstack/react-router'

import SupportPage from '@/app/support'

export const Route = createLazyFileRoute('/support')({
  component: SupportPage,
})

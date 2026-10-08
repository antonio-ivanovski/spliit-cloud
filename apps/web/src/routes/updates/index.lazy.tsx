import { createLazyFileRoute } from '@tanstack/react-router'

import UpdatesPage from '@/app/updates'

export const Route = createLazyFileRoute('/updates/')({
  component: UpdatesPage,
})

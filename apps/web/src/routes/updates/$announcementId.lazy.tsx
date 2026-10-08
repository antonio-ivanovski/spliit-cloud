import { createLazyFileRoute } from '@tanstack/react-router'

import UpdateDetailPage from '@/app/updates-detail'

export const Route = createLazyFileRoute('/updates/$announcementId')({
  component: UpdateDetailPage,
})

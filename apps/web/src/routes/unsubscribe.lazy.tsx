import { createLazyFileRoute } from '@tanstack/react-router'

import UnsubscribePage from '@/app/unsubscribe'

export const Route = createLazyFileRoute('/unsubscribe')({
  component: UnsubscribePage,
})

import UnsubscribePage from '@/app/unsubscribe'
import { createLazyFileRoute } from '@tanstack/react-router'

export const Route = createLazyFileRoute('/unsubscribe')({
  component: UnsubscribePage,
})

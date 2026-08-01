import { createLazyFileRoute } from '@tanstack/react-router'

import FeedbackPage from '@/app/feedback'

export const Route = createLazyFileRoute('/feedback')({
  component: FeedbackPage,
})

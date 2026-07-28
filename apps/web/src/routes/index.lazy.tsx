import { createLazyFileRoute } from '@tanstack/react-router'

import HomePage from '@/app/page'

export const Route = createLazyFileRoute('/')({
  component: HomePage,
})

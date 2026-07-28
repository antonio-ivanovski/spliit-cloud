import { createLazyFileRoute } from '@tanstack/react-router'

import ImprintPage from '@/app/imprint'

export const Route = createLazyFileRoute('/imprint')({
  component: ImprintPage,
})

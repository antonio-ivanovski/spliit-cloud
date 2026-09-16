import { createLazyFileRoute } from '@tanstack/react-router'

import SponsorPage from '@/app/sponsor'

export const Route = createLazyFileRoute('/sponsor')({
  component: SponsorPage,
})

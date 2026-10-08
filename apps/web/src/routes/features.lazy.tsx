import { createLazyFileRoute } from '@tanstack/react-router'

import FeaturesPage from '@/app/features/page'

export const Route = createLazyFileRoute('/features')({
  component: FeaturesPage,
})

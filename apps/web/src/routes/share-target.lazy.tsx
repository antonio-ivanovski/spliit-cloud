import { createLazyFileRoute } from '@tanstack/react-router'

import ShareTargetPage from '@/app/share-target/page'

export const Route = createLazyFileRoute('/share-target')({
  component: ShareTargetPage,
})

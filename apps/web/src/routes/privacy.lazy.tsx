import { createLazyFileRoute } from '@tanstack/react-router'

import PrivacyPage from '@/app/privacy'

export const Route = createLazyFileRoute('/privacy')({
  component: PrivacyPage,
})

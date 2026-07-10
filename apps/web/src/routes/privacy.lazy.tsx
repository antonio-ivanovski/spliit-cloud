import PrivacyPage from '@/app/privacy'
import { createLazyFileRoute } from '@tanstack/react-router'

export const Route = createLazyFileRoute('/privacy')({
  component: PrivacyPage,
})

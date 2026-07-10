import TermsPage from '@/app/terms'
import { createLazyFileRoute } from '@tanstack/react-router'

export const Route = createLazyFileRoute('/terms')({
  component: TermsPage,
})

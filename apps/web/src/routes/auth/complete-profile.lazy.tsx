import { CompleteProfilePage } from '@/app/auth/complete-profile'
import { createLazyFileRoute } from '@tanstack/react-router'

export const Route = createLazyFileRoute('/auth/complete-profile')({
  component: CompleteProfilePage,
})

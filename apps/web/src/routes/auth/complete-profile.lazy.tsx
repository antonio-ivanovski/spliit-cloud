import { createLazyFileRoute } from '@tanstack/react-router'

import { CompleteProfilePage } from '@/app/auth/complete-profile'

export const Route = createLazyFileRoute('/auth/complete-profile')({
  component: CompleteProfilePage,
})

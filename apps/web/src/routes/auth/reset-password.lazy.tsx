import { createLazyFileRoute } from '@tanstack/react-router'

import { ResetPasswordPage } from '@/app/auth/reset-password'

export const Route = createLazyFileRoute('/auth/reset-password')({
  component: ResetPasswordPage,
})

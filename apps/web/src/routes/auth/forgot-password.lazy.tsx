import { createLazyFileRoute } from '@tanstack/react-router'

import { ForgotPasswordPage } from '@/app/auth/forgot-password'

export const Route = createLazyFileRoute('/auth/forgot-password')({
  component: ForgotPasswordPage,
})

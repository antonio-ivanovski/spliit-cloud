import { ResetPasswordPage } from '@/app/auth/reset-password'
import { createLazyFileRoute } from '@tanstack/react-router'

export const Route = createLazyFileRoute('/auth/reset-password')({
  component: ResetPasswordPage,
})

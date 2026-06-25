import { ForgotPasswordPage } from '@/app/auth/forgot-password'
import { createLazyFileRoute } from '@tanstack/react-router'

export const Route = createLazyFileRoute('/auth/forgot-password')({
  component: ForgotPasswordPage,
})

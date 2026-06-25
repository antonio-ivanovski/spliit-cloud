import { forgotPasswordSearchSchema } from '@/router/schemas'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/auth/forgot-password')({
  validateSearch: forgotPasswordSearchSchema,
})

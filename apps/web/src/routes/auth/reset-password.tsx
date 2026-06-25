import { resetPasswordSearchSchema } from '@/router/schemas'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/auth/reset-password')({
  validateSearch: resetPasswordSearchSchema,
})

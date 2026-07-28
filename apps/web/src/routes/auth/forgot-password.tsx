import { createFileRoute } from '@tanstack/react-router'

import { forgotPasswordSearchSchema } from '@/router/schemas'

export const Route = createFileRoute('/auth/forgot-password')({
  validateSearch: forgotPasswordSearchSchema,
})

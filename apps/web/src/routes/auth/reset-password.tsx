import { createFileRoute } from '@tanstack/react-router'

import { resetPasswordSearchSchema } from '@/router/schemas'

export const Route = createFileRoute('/auth/reset-password')({
  validateSearch: resetPasswordSearchSchema,
})

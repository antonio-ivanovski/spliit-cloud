import { createFileRoute } from '@tanstack/react-router'

import { completeProfileSearchSchema } from '@/router/schemas'

export const Route = createFileRoute('/auth/complete-profile')({
  validateSearch: completeProfileSearchSchema,
})

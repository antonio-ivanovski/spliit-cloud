import { completeProfileSearchSchema } from '@/router/schemas'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/auth/complete-profile')({
  validateSearch: completeProfileSearchSchema,
})

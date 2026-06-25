import { homeSearchSchema } from '@/router/schemas'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  validateSearch: homeSearchSchema,
})

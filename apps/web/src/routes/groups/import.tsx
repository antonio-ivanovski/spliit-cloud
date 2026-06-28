import { importGroupSearchSchema } from '@/router/schemas'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/groups/import')({
  validateSearch: importGroupSearchSchema,
})

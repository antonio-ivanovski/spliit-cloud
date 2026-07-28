import { createFileRoute } from '@tanstack/react-router'

import { importGroupSearchSchema } from '@/router/schemas'

export const Route = createFileRoute('/groups/import')({
  validateSearch: importGroupSearchSchema,
})

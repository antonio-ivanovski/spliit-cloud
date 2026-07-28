import { createFileRoute } from '@tanstack/react-router'

import { homeSearchSchema } from '@/router/schemas'

export const Route = createFileRoute('/')({
  validateSearch: homeSearchSchema,
})

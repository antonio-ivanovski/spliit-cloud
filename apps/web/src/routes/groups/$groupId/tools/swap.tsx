import { createFileRoute } from '@tanstack/react-router'

import { swapSearchSchema } from '@/router/schemas'

export const Route = createFileRoute('/groups/$groupId/tools/swap')({
  validateSearch: swapSearchSchema,
})

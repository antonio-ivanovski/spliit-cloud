import { createFileRoute } from '@tanstack/react-router'

import { balancesSearchSchema } from '@/router/schemas'

export const Route = createFileRoute('/groups/$groupId/balances')({
  validateSearch: balancesSearchSchema,
})

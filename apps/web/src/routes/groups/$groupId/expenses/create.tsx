import { createFileRoute } from '@tanstack/react-router'

import { createExpenseSearchSchema } from '@/router/schemas'

export const Route = createFileRoute('/groups/$groupId/expenses/create')({
  validateSearch: createExpenseSearchSchema,
})

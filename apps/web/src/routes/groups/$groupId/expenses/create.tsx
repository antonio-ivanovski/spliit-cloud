import { createExpenseSearchSchema } from '@/router/schemas'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/groups/$groupId/expenses/create')({
  validateSearch: createExpenseSearchSchema,
})

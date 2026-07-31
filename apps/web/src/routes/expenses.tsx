import { createFileRoute } from '@tanstack/react-router'

import { globalExpensesSearchSchema } from '@/router/schemas'

export const Route = createFileRoute('/expenses')({
  validateSearch: globalExpensesSearchSchema,
})

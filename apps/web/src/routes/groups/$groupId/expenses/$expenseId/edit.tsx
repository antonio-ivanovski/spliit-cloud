import { createFileRoute } from '@tanstack/react-router'

import { editExpenseSearchSchema, expenseParamsSchema } from '@/router/schemas'

export const Route = createFileRoute(
  '/groups/$groupId/expenses/$expenseId/edit',
)({
  params: {
    parse: (input) => expenseParamsSchema.parse(input),
    stringify: (params) => ({
      groupId: params.groupId,
      expenseId: params.expenseId,
    }),
  },
  validateSearch: editExpenseSearchSchema,
})

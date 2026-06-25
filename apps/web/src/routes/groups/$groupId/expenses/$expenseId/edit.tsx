import { expenseParamsSchema } from '@/router/schemas'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute(
  '/groups/$groupId/expenses/$expenseId/edit',
)({
  params: {
    parse: expenseParamsSchema.parse,
    stringify: (params) => ({
      groupId: params.groupId,
      expenseId: params.expenseId,
    }),
  },
})

import { expenseParamsSchema } from '@/router/schemas'
import { createFileRoute } from '@tanstack/react-router'

// The bare expense URL is the route-backed lightweight expense preview.
export const Route = createFileRoute('/groups/$groupId/expenses/$expenseId/')({
  params: {
    parse: expenseParamsSchema.parse,
    stringify: (params) => ({
      groupId: params.groupId,
      expenseId: params.expenseId,
    }),
  },
})

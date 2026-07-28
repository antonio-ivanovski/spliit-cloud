import { createFileRoute } from '@tanstack/react-router'

import { expenseParamsSchema } from '@/router/schemas'

// The bare expense URL is the route-backed lightweight expense preview.
export const Route = createFileRoute('/groups/$groupId/expenses/$expenseId/')({
  params: {
    parse: (input) => expenseParamsSchema.parse(input),
    stringify: (params) => ({
      groupId: params.groupId,
      expenseId: params.expenseId,
    }),
  },
})

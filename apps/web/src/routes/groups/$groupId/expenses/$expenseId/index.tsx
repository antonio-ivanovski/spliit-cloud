import { expenseParamsSchema } from '@/router/schemas'
import { createFileRoute } from '@tanstack/react-router'

// The bare expense URL is reserved for the future view-only expense page.
// Until that ships, direct navigation here lands on the edit form.
export const Route = createFileRoute('/groups/$groupId/expenses/$expenseId/')({
  params: {
    parse: expenseParamsSchema.parse,
    stringify: (params) => ({
      groupId: params.groupId,
      expenseId: params.expenseId,
    }),
  },
})

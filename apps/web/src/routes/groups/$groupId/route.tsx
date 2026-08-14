import { createFileRoute, retainSearchParams } from '@tanstack/react-router'

import { groupParamsSchema, groupSearchSchema } from '@/router/schemas'

export const Route = createFileRoute('/groups/$groupId')({
  params: {
    parse: (input) => groupParamsSchema.parse(input),
    stringify: (params) => ({ groupId: params.groupId }),
  },
  validateSearch: groupSearchSchema,
  search: {
    middlewares: [retainSearchParams(['viewKey', 'invite'])],
  },
})

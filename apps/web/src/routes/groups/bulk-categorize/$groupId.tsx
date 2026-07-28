import { createFileRoute } from '@tanstack/react-router'

import { groupParamsSchema } from '@/router/schemas'

export const Route = createFileRoute('/groups/bulk-categorize/$groupId')({
  params: {
    parse: (input) => groupParamsSchema.parse(input),
    stringify: (params) => ({ groupId: params.groupId }),
  },
})

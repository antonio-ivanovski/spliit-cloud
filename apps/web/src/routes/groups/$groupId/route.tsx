import { groupParamsSchema, groupSearchSchema } from '@/router/schemas'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/groups/$groupId')({
  params: {
    parse: groupParamsSchema.parse,
    stringify: (params) => ({ groupId: params.groupId }),
  },
  validateSearch: groupSearchSchema,
})

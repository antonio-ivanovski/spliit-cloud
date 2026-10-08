import { createFileRoute } from '@tanstack/react-router'

import { announcementParamsSchema } from '@/router/schemas'

export const Route = createFileRoute('/updates/$announcementId')({
  params: {
    parse: (input) => announcementParamsSchema.parse(input),
    stringify: (params) => ({ announcementId: params.announcementId }),
  },
})

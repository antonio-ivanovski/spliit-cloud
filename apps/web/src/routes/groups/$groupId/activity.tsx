import { createFileRoute } from '@tanstack/react-router'

import { activitySearchSchema } from '@/router/schemas'

export const Route = createFileRoute('/groups/$groupId/activity')({
  validateSearch: activitySearchSchema,
})

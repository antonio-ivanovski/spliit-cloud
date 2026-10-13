import { createFileRoute } from '@tanstack/react-router'

import { shareTargetSearchSchema } from '@/router/schemas'

export const Route = createFileRoute('/share-target')({
  validateSearch: shareTargetSearchSchema,
})

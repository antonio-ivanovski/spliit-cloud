import { createFileRoute } from '@tanstack/react-router'

import { oauthFlowSearchSchema } from '@/router/schemas'

export const Route = createFileRoute('/oauth/consent')({
  validateSearch: oauthFlowSearchSchema,
})

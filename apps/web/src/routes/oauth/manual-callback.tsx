import { createFileRoute } from '@tanstack/react-router'

import { oauthManualCallbackSearchSchema } from '@/router/schemas'

export const Route = createFileRoute('/oauth/manual-callback')({
  validateSearch: oauthManualCallbackSearchSchema,
})

import { createLazyFileRoute } from '@tanstack/react-router'

import { OAuthManualCallbackPage } from '@/app/oauth/oauth-manual-callback-page'

export const Route = createLazyFileRoute('/oauth/manual-callback')({
  component: OAuthManualCallbackPage,
})

import { createLazyFileRoute } from '@tanstack/react-router'

import { OAuthConsentPage } from '@/app/oauth/oauth-consent-page'

export const Route = createLazyFileRoute('/oauth/consent')({
  component: OAuthConsentPage,
})

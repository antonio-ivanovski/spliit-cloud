import { createLazyFileRoute } from '@tanstack/react-router'

import { OAuthLoginPage } from '@/app/oauth/oauth-login-page'

export const Route = createLazyFileRoute('/oauth/login')({
  component: OAuthLoginPage,
})

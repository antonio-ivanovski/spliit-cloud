import { oauthProviderClient } from '@better-auth/oauth-provider/client'
import { anonymousClient, magicLinkClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

import { getApiBaseUrl } from './api-url'
import { trackedFetch } from './connectivity'

/**
 * Spliit web auth client. Talks to the better-auth handler mounted at `/auth/*`
 * on the API server. Cookies are sent with credentials so the SPA does not need
 * to store bearer tokens in localStorage.
 *
 * The API uses `betterAuth` with `Account`/`Session`/`AuthIdentity` model
 * names; the client only needs to know the base URL and that sessions are
 * cookie-based.
 */
const apiBaseUrl = getApiBaseUrl()

export const authClient = createAuthClient({
  baseURL: `${apiBaseUrl}/auth`,
  fetchOptions: {
    credentials: 'include',
    customFetchImpl: trackedFetch,
  },
  plugins: [oauthProviderClient(), magicLinkClient(), anonymousClient()],
})

export type AuthSession = NonNullable<
  ReturnType<typeof authClient.useSession>['data']
>

export type AuthAccount = Omit<AuthSession['user'], 'isAnonymous'> & {
  isAnonymous?: boolean | null
  anonymousOnboardingCompleted?: boolean | null
}

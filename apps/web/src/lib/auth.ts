import { magicLinkClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

/**
 * Spliit web auth client. Talks to the better-auth handler mounted at
 * `/api/auth/*` on the API server. Cookies are sent with credentials so the
 * SPA does not need to store bearer tokens in localStorage.
 *
 * The API uses `betterAuth` with `Account`/`Session`/`AuthIdentity` model
 * names; the client only needs to know the base URL and that sessions are
 * cookie-based.
 */
const apiBaseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

export const authClient = createAuthClient({
  baseURL: `${apiBaseUrl}/api/auth`,
  fetchOptions: {
    credentials: 'include',
  },
  plugins: [magicLinkClient()],
})

export type AuthSession = NonNullable<
  ReturnType<typeof authClient.useSession>['data']
>

export type AuthAccount = AuthSession['user']

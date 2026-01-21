import { randomId } from '@/lib/api'
import { env } from '@/lib/env'
import { cookies } from 'next/headers'

const STATE_COOKIE = 'spliit_sync_oauth_state_google'
const STATE_TTL_SECONDS = 10 * 60

const googleClientConfigured =
  !!env.GOOGLE_OAUTH_CLIENT_ID && !!env.GOOGLE_OAUTH_CLIENT_SECRET

const createStateToken = () => randomId(32)

const buildGoogleAuthUrl = (state: string) => {
  const target = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  const redirectUrl = new URL(
    '/api/auth/oauth/google/callback',
    env.NEXT_PUBLIC_BASE_URL,
  )
  target.searchParams.set('client_id', env.GOOGLE_OAUTH_CLIENT_ID ?? '')
  target.searchParams.set('redirect_uri', redirectUrl.toString())
  target.searchParams.set('response_type', 'code')
  target.searchParams.set('scope', 'email profile')
  target.searchParams.set('state', state)
  target.searchParams.set('access_type', 'online')
  target.searchParams.set('prompt', 'consent')
  return target
}

export async function GET(req: Request) {
  if (!googleClientConfigured) {
    return Response.json(
      { error: 'Google OAuth is not configured', code: 'oauth_not_configured' },
      { status: 404 },
    )
  }

  const state = createStateToken()
  const cookieStore = await cookies()
  cookieStore.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: STATE_TTL_SECONDS,
    path: '/',
  })

  const authUrl = buildGoogleAuthUrl(state)
  return Response.redirect(authUrl)
}

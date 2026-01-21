import { randomId } from '@/lib/api'
import { env } from '@/lib/env'
import { cookies } from 'next/headers'

const STATE_COOKIE = 'spliit_sync_oauth_state_github'
const STATE_TTL_SECONDS = 10 * 60

const githubClientConfigured =
  !!env.GITHUB_OAUTH_CLIENT_ID && !!env.GITHUB_OAUTH_CLIENT_SECRET

const createStateToken = () => randomId(32)

const buildGithubAuthUrl = (state: string) => {
  const target = new URL('https://github.com/login/oauth/authorize')
  const redirectUrl = new URL('/api/auth/oauth/github/callback', env.NEXT_PUBLIC_BASE_URL)
  target.searchParams.set('client_id', env.GITHUB_OAUTH_CLIENT_ID ?? '')
  target.searchParams.set('redirect_uri', redirectUrl.toString())
  target.searchParams.set('scope', 'user:email')
  target.searchParams.set('state', state)
  return target
}

export async function GET() {
  if (!githubClientConfigured) {
    return Response.json(
      { error: 'GitHub OAuth is not configured', code: 'oauth_not_configured' },
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

  const authUrl = buildGithubAuthUrl(state)
  return Response.redirect(authUrl)
}

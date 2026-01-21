import { createSession } from '@/lib/auth'
import { env } from '@/lib/env'
import { prisma } from '@/lib/prisma'
import { cookies } from 'next/headers'

const STATE_COOKIE = 'spliit_sync_oauth_state_google'

const googleClientConfigured =
  !!env.GOOGLE_OAUTH_CLIENT_ID && !!env.GOOGLE_OAUTH_CLIENT_SECRET

type GoogleTokenResponse = {
  access_token?: string
}

type GoogleUserInfo = {
  sub?: string
  email?: string
}

const buildRedirectUrl = (requestUrl: string, sessionToken: string) => {
  const target = new URL('/settings', requestUrl)
  target.searchParams.set('session', sessionToken)
  return target
}

const getRedirectUri = () =>
  new URL('/api/auth/oauth/google/callback', env.NEXT_PUBLIC_BASE_URL).toString()

const exchangeCodeForToken = async (code: string) => {
  const body = new URLSearchParams({
    client_id: env.GOOGLE_OAUTH_CLIENT_ID ?? '',
    client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET ?? '',
    code,
    redirect_uri: getRedirectUri(),
    grant_type: 'authorization_code',
  })

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  if (!response.ok) {
    throw new Error('Failed to exchange Google OAuth code')
  }

  return (await response.json()) as GoogleTokenResponse
}

const fetchGoogleUserInfo = async (accessToken: string) => {
  const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) {
    throw new Error('Failed to fetch Google user info')
  }

  return (await response.json()) as GoogleUserInfo
}

const syncUserStore = (prisma as unknown as { syncUser: any }).syncUser

const resolveSyncUser = async (email: string, googleId: string) => {
  const existingByProvider = await syncUserStore.findUnique({
    where: { googleId },
  })

  if (existingByProvider) return existingByProvider

  const existingByEmail = await syncUserStore.findUnique({
    where: { email },
  })

  if (existingByEmail) {
    return syncUserStore.update({
      where: { email },
      data: { googleId },
    })
  }

  return syncUserStore.create({
    data: { email, googleId },
  })
}

export async function GET(req: Request) {
  if (!googleClientConfigured) {
    return Response.json(
      { error: 'Google OAuth is not configured', code: 'oauth_not_configured' },
      { status: 404 },
    )
  }

  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')

  if (!code || !state) {
    return Response.json(
      { error: 'Missing OAuth parameters', code: 'missing_parameters' },
      { status: 400 },
    )
  }

  const cookieStore = await cookies()
  const storedState = cookieStore.get(STATE_COOKIE)?.value
  cookieStore.delete(STATE_COOKIE)

  if (!storedState || storedState !== state) {
    return Response.json({ error: 'Invalid state', code: 'invalid_state' }, { status: 400 })
  }

  try {
    const tokenResponse = await exchangeCodeForToken(code)
    const accessToken = tokenResponse.access_token

    if (!accessToken) {
      return Response.json(
        { error: 'Missing access token', code: 'missing_access_token' },
        { status: 400 },
      )
    }

    const userInfo = await fetchGoogleUserInfo(accessToken)
    const email = userInfo.email?.toLowerCase()
    const googleId = userInfo.sub

    if (!email || !googleId) {
      return Response.json(
        { error: 'Missing user info', code: 'missing_user_info' },
        { status: 400 },
      )
    }

    const user = await resolveSyncUser(email, googleId)
    const session = await createSession(user.id)
    const redirectUrl = buildRedirectUrl(req.url, session.token)

    return Response.redirect(redirectUrl)
  } catch (error) {
    console.error('Failed to complete Google OAuth', error)
    return Response.json({ error: 'Unexpected error' }, { status: 500 })
  }
}

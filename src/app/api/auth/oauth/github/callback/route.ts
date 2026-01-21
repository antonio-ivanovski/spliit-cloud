import { createSession } from '@/lib/auth'
import { env } from '@/lib/env'
import { prisma } from '@/lib/prisma'
import { cookies } from 'next/headers'

const STATE_COOKIE = 'spliit_sync_oauth_state_github'

const githubClientConfigured =
  !!env.GITHUB_OAUTH_CLIENT_ID && !!env.GITHUB_OAUTH_CLIENT_SECRET

type GithubTokenResponse = {
  access_token?: string
}

type GithubUserInfo = {
  id?: number
  email?: string | null
}

type GithubEmailInfo = {
  email: string
  primary: boolean
  verified: boolean
}

const buildRedirectUrl = (requestUrl: string, sessionToken: string) => {
  const target = new URL('/settings', requestUrl)
  target.searchParams.set('session', sessionToken)
  return target
}

const getRedirectUri = () =>
  new URL(
    '/api/auth/oauth/github/callback',
    env.NEXT_PUBLIC_BASE_URL,
  ).toString()

const exchangeCodeForToken = async (code: string) => {
  const body = new URLSearchParams({
    client_id: env.GITHUB_OAUTH_CLIENT_ID ?? '',
    client_secret: env.GITHUB_OAUTH_CLIENT_SECRET ?? '',
    code,
    redirect_uri: getRedirectUri(),
  })

  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  })

  if (!response.ok) {
    throw new Error('Failed to exchange GitHub OAuth code')
  }

  return (await response.json()) as GithubTokenResponse
}

const fetchGithubUser = async (accessToken: string) => {
  const response = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': 'spliit',
    },
  })

  if (!response.ok) {
    throw new Error('Failed to fetch GitHub user info')
  }

  return (await response.json()) as GithubUserInfo
}

const fetchGithubEmails = async (accessToken: string) => {
  const response = await fetch('https://api.github.com/user/emails', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': 'spliit',
    },
  })

  if (!response.ok) {
    throw new Error('Failed to fetch GitHub email info')
  }

  return (await response.json()) as GithubEmailInfo[]
}

const resolveGithubEmail = async (
  accessToken: string,
  userEmail?: string | null,
) => {
  if (userEmail) return userEmail
  const emails = await fetchGithubEmails(accessToken)
  return emails.find((email) => email.primary)?.email ?? emails[0]?.email
}

const resolveSyncUser = async (email: string, githubId: string) => {
  const existingByProvider = await prisma.syncUser.findUnique({
    where: { githubId },
  })

  if (existingByProvider) return existingByProvider

  const existingByEmail = await prisma.syncUser.findUnique({
    where: { email },
  })

  if (existingByEmail) {
    return prisma.syncUser.update({
      where: { email },
      data: { githubId },
    })
  }

  return prisma.syncUser.create({
    data: { email, githubId },
  })
}

export async function GET(req: Request) {
  if (!githubClientConfigured) {
    return Response.json(
      { error: 'GitHub OAuth is not configured', code: 'oauth_not_configured' },
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
    return Response.json(
      { error: 'Invalid state', code: 'invalid_state' },
      { status: 400 },
    )
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

    const userInfo = await fetchGithubUser(accessToken)
    const githubId = userInfo.id ? String(userInfo.id) : null
    const email = await resolveGithubEmail(accessToken, userInfo.email)

    if (!email || !githubId) {
      return Response.json(
        { error: 'Missing user info', code: 'missing_user_info' },
        { status: 400 },
      )
    }

    const user = await resolveSyncUser(email.toLowerCase(), githubId)
    const session = await createSession(user.id)
    const redirectUrl = buildRedirectUrl(req.url, session.token)

    return Response.redirect(redirectUrl)
  } catch (error) {
    console.error('Failed to complete GitHub OAuth', error)
    return Response.json({ error: 'Unexpected error' }, { status: 500 })
  }
}

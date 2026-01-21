import { validateMagicLink } from '@/lib/auth/magic-link'
import { createSession } from '@/lib/auth/session'
import { prisma } from '@/lib/prisma'

const buildRedirectUrl = (requestUrl: string, sessionToken: string) => {
  const target = new URL('/settings', requestUrl)
  target.searchParams.set('session', sessionToken)
  return target
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const token = url.searchParams.get('token')

    if (!token) {
      return Response.json(
        { error: 'Missing token', code: 'missing_token' },
        { status: 400 },
      )
    }

    const tokenRecord = await validateMagicLink(token)

    if (!tokenRecord) {
      return Response.json(
        { error: 'Invalid or expired token', code: 'invalid_token' },
        { status: 400 },
      )
    }

    const user = await prisma.syncUser.upsert({
      where: { email: tokenRecord.email },
      update: {},
      create: { email: tokenRecord.email },
    })

    const session = await createSession(user.id)
    const redirectUrl = buildRedirectUrl(req.url, session.token)

    return Response.redirect(redirectUrl)
  } catch (error) {
    console.error('Failed to verify magic link', error)
    return Response.json({ error: 'Unexpected error' }, { status: 500 })
  }
}

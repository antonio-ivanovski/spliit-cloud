import { getSessionFromRequest } from '@/lib/auth/session'

export async function GET(request: Request) {
  try {
    const session = await getSessionFromRequest(request)

    if (!session) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    return Response.json({
      user: {
        id: session.user.id,
        email: session.user.email,
      },
    })
  } catch (error) {
    console.error('Failed to validate session', error)
    return Response.json({ error: 'Unexpected error' }, { status: 500 })
  }
}

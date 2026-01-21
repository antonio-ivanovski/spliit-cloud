import { deleteAllUserSessions, getSessionFromRequest } from '@/lib/auth'

export async function POST(request: Request) {
  try {
    const session = await getSessionFromRequest(request)

    if (!session) {
      return Response.json(
        { error: 'Invalid session', code: 'invalid_session' },
        { status: 401 },
      )
    }

    await deleteAllUserSessions(session.userId)
    return Response.json({ success: true })
  } catch (error) {
    console.error('Failed to logout all sessions', error)
    return Response.json({ error: 'Unexpected error' }, { status: 500 })
  }
}

import { deleteSession, validateSession } from '@/lib/auth'

const getBearerToken = (request: Request) => {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return null
  return authHeader.slice(7)
}

export async function POST(request: Request) {
  try {
    const headerToken = getBearerToken(request)
    const body = headerToken ? null : await request.json().catch(() => null)
    const tokenPayload = body as { token?: unknown } | null
    const token =
      headerToken ??
      (typeof tokenPayload?.token === 'string' ? tokenPayload.token : null)

    if (!token) {
      return Response.json(
        { error: 'Missing session token', code: 'missing_session' },
        { status: 401 },
      )
    }

    const session = await validateSession(token)
    if (!session) {
      return Response.json(
        { error: 'Invalid session', code: 'invalid_session' },
        { status: 401 },
      )
    }

    await deleteSession(token)
    return Response.json({ success: true })
  } catch (error) {
    console.error('Failed to logout session', error)
    return Response.json({ error: 'Unexpected error' }, { status: 500 })
  }
}

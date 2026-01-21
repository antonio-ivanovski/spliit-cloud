import { deleteAllUserSessions, getSessionFromRequest } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const prismaClient = prisma as any

export async function DELETE(request: Request) {
  try {
    const session = await getSessionFromRequest(request)

    if (!session) {
      return Response.json(
        { error: 'Invalid session', code: 'invalid_session' },
        { status: 401 },
      )
    }

    await deleteAllUserSessions(session.userId)
    await prismaClient.syncedGroup.deleteMany({ where: { userId: session.userId } })
    await prismaClient.syncUser.delete({ where: { id: session.userId } })

    return Response.json({ success: true })
  } catch (error) {
    console.error('Failed to delete sync account', error)
    return Response.json({ error: 'Unexpected error' }, { status: 500 })
  }
}

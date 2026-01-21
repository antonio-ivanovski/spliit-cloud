import crypto from 'crypto'

import { prisma } from '@/lib/prisma'

type SyncUser = {
  id: string
  email: string
  createdAt: Date
  googleId: string | null
  githubId: string | null
}

const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000
const SESSION_REFRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

const prismaClient = prisma as any

const getExpiresAt = () => new Date(Date.now() + SESSION_DURATION_MS)

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

export async function createSession(
  userId: string,
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSessionToken()
  const expiresAt = getExpiresAt()

  await prismaClient.syncSession.create({
    data: {
      userId,
      token,
      expiresAt,
    },
  })

  return { token, expiresAt }
}

export async function validateSession(
  token: string,
): Promise<{ userId: string; user: SyncUser } | null> {
  const session = await prismaClient.syncSession.findUnique({
    where: { token },
    include: { user: true },
  })

  if (!session) {
    return null
  }

  if (session.expiresAt.getTime() <= Date.now()) {
    await prismaClient.syncSession.delete({ where: { id: session.id } })
    return null
  }

  const timeRemaining = session.expiresAt.getTime() - Date.now()
  if (timeRemaining <= SESSION_REFRESH_WINDOW_MS) {
    await prismaClient.syncSession.update({
      where: { id: session.id },
      data: { expiresAt: getExpiresAt() },
    })
  }

  return { userId: session.userId, user: session.user }
}

export async function deleteSession(token: string): Promise<void> {
  await prismaClient.syncSession.deleteMany({ where: { token } })
}

export async function deleteAllUserSessions(userId: string): Promise<void> {
  await prismaClient.syncSession.deleteMany({ where: { userId } })
}

export async function getSessionFromRequest(request: Request) {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice(7)
  return validateSession(token)
}

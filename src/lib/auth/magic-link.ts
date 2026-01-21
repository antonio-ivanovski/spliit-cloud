import crypto from 'crypto'

import { env } from '@/lib/env'
import { prisma } from '@/lib/prisma'

const MAGIC_LINK_DURATION_MS = 15 * 60 * 1000

const prismaClient = prisma as any

const getExpiresAt = () => new Date(Date.now() + MAGIC_LINK_DURATION_MS)

export function generateMagicLinkToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

export async function createMagicLink(
  email: string,
): Promise<{ token: string; url: string }> {
  const token = generateMagicLinkToken()
  const expiresAt = getExpiresAt()

  await prismaClient.magicLinkToken.create({
    data: {
      email,
      token,
      expiresAt,
    },
  })

  const url = new URL('/api/auth/magic-link/verify', env.NEXT_PUBLIC_BASE_URL)
  url.searchParams.set('token', token)

  return { token, url: url.toString() }
}

export async function validateMagicLink(
  token: string,
): Promise<{ email: string } | null> {
  const record = await prismaClient.magicLinkToken.findUnique({
    where: { token },
  })

  if (!record || record.used || record.expiresAt.getTime() <= Date.now()) {
    return null
  }

  await prismaClient.magicLinkToken.update({
    where: { id: record.id },
    data: { used: true },
  })

  return { email: record.email }
}

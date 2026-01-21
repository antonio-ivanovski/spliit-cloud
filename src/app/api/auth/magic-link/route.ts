import { sendMagicLinkEmail } from '@/lib/auth/email'
import { createMagicLink } from '@/lib/auth/magic-link'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const requestSchema = z.object({
  email: z.string().email(),
})

const requestTracker = new Map<string, number[]>()
const MAX_REQUESTS_PER_HOUR = 5
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000

const cleanupRequestTracker = (email: string, now: number) => {
  const existing = requestTracker.get(email)
  if (!existing) return []

  const filtered = existing.filter((timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS)
  if (filtered.length === 0) {
    requestTracker.delete(email)
  } else {
    requestTracker.set(email, filtered)
  }
  return filtered
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const parsed = requestSchema.safeParse(body)

    if (!parsed.success) {
      return Response.json({ error: 'Invalid email', code: 'invalid_email' }, { status: 400 })
    }

    const email = parsed.data.email.toLowerCase()
    const now = Date.now()
    const recentRequests = cleanupRequestTracker(email, now)

    if (recentRequests.length >= MAX_REQUESTS_PER_HOUR) {
      return Response.json(
        { error: 'Too many requests', code: 'rate_limited' },
        { status: 429 },
      )
    }

    requestTracker.set(email, [...recentRequests, now])

    await (prisma as unknown as { syncUser: any }).syncUser.upsert({
      where: { email },
      update: {},
      create: { email },
    })

    const magicLink = await createMagicLink(email)

    await sendMagicLinkEmail(email, magicLink.url)

    return Response.json({ success: true })
  } catch (error) {
    console.error('Failed to request magic link', error)
    return Response.json({ error: 'Unexpected error' }, { status: 500 })
  }
}

import type { Prisma } from '@spliit/db'

export const accountSummarySelect = {
  id: true,
  name: true,
  image: true,
} satisfies Prisma.UserSelect

export type AccountSummary = Prisma.UserGetPayload<{
  select: typeof accountSummarySelect
}>

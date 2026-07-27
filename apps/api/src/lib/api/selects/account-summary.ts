import type { Prisma } from '@spliit/db'

export const accountSummarySelect = {
  id: true,
  name: true,
  image: true,
} satisfies Prisma.AccountSelect

export type AccountSummary = Prisma.AccountGetPayload<{
  select: typeof accountSummarySelect
}>

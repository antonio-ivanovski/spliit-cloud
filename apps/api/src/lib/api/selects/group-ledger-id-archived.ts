import type { Prisma } from '@spliit/db'

export const groupLedgerIdArchivedSelect = {
  ledgerId: true,
  archived: true,
} satisfies Prisma.GroupSelect

export type GroupLedgerIdArchived = Prisma.GroupGetPayload<{
  select: typeof groupLedgerIdArchivedSelect
}>

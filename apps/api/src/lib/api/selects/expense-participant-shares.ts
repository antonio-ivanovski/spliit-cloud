import type { Prisma } from '@spliit/db'

// `ExpensePaidBy` and `ExpensePaidFor` share the same column shape
// (expenseId, ledgerParticipantId, shares), so a single select covers both.
export const expenseParticipantSharesSelect = {
  ledgerParticipantId: true,
  shares: true,
} satisfies Prisma.ExpensePaidBySelect

export type ExpenseParticipantShares = Prisma.ExpensePaidByGetPayload<{
  select: typeof expenseParticipantSharesSelect
}>

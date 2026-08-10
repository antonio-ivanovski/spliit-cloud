import type { Prisma } from '@spliit/db'

import { participantDisplayNameSelect } from './participant-display-name'

// Projection for an expense's paidBy/paidFor row when the caller needs to
// render the participant's human-readable name (activity feeds, expense list).
// `ExpensePaidBy` and `ExpensePaidFor` share the same column
// shape so a single select covers both.
export const expenseParticipantWithDisplayNameSelect = {
  shares: true,
  ledgerParticipant: { select: participantDisplayNameSelect() },
} satisfies Prisma.ExpensePaidBySelect

export type ExpenseParticipantWithDisplayName = Prisma.ExpensePaidByGetPayload<{
  select: typeof expenseParticipantWithDisplayNameSelect
}>

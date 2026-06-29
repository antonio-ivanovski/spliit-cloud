import { ActivityType, prisma, RecurrenceRule, type Prisma } from '@spliit/db'
import {
  getBalances,
  getPublicBalances,
  getSuggestedReimbursements,
  PAYMENT_CATEGORY_ID,
  type BalanceExpense,
  type Balances,
  type Reimbursement,
} from '@spliit/domain'
import { logActivity } from './activities'
import { getGroupExpenses } from './expenses'
import { getMemberLedgerParticipantId, randomId } from './shared'

/**
 * Compute the per-ledger-participant balance for every member of a group.
 */
export async function getGroupBalances(groupId: string): Promise<Balances> {
  const rows = await getGroupExpenses(groupId)
  const expenses: BalanceExpense[] = rows.map((row) => ({
    ...row,
    paidByList: row.paidByList.map((pb) => ({
      shares: pb.shares,
      participant: pb.ledgerParticipant,
    })),
    paidFor: row.paidFor.map((pf) => ({
      shares: pf.shares,
      participant: pf.ledgerParticipant,
    })),
  }))
  const balances = getBalances(expenses)
  const reimbursements = getSuggestedReimbursements(balances)
  return getPublicBalances(reimbursements)
}

/**
 * Returns `true` if any ledger participant in the balance map has a
 * non-zero total.
 */
export function hasUnsettledBalances(balances: Balances): boolean {
  for (const id in balances) {
    if (balances[id].total !== 0) return true
  }
  return false
}

const SETTLEMENT_TITLE = 'Settlement on archive'

/**
 * Build the optimal list of "settlement legs" (from, to, amount) that
 * zero out the group's balances.
 */
export function buildSettlementLegs(balances: Balances): Reimbursement[] {
  return getSuggestedReimbursements(balances)
}

/**
 * Create one reimbursement-style `Expense` per settlement leg produced by
 * {@link buildSettlementLegs}.
 */
export async function createSettlementExpensesForArchive(
  groupId: string,
  actor: { accountId: string },
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<{ createdExpenses: number }> {
  const balances = await getGroupBalances(groupId)
  if (!hasUnsettledBalances(balances)) {
    return { createdExpenses: 0 }
  }

  const group = await client.group.findUnique({
    where: { id: groupId },
    select: { ledgerId: true },
  })
  if (!group?.ledgerId) {
    throw new Error('Cannot settle balances: group has no ledger')
  }

  const legs = buildSettlementLegs(balances)
  if (legs.length === 0) {
    return { createdExpenses: 0 }
  }

  const actorLedgerParticipantId = await getMemberLedgerParticipantId(
    groupId,
    actor.accountId,
    client,
  )

  const now = new Date()
  for (const leg of legs) {
    if (leg.amount <= 0) continue
    const expenseId = randomId()
    await logActivity(
      groupId,
      ActivityType.CREATE_EXPENSE,
      {
        accountId: actor.accountId,
        ledgerParticipantId: actorLedgerParticipantId,
        expenseId,
        data: SETTLEMENT_TITLE,
      },
      client,
    )
    await client.expense.create({
      data: {
        id: expenseId,
        ledgerId: group.ledgerId,
        expenseDate: now,
        title: SETTLEMENT_TITLE,
        categoryId: PAYMENT_CATEGORY_ID,
        amount: leg.amount,
        paidBySplitMode: 'BY_AMOUNT',
        paidByList: {
          createMany: {
            data: [{ ledgerParticipantId: leg.from, shares: leg.amount }],
          },
        },
        splitMode: 'EVENLY',
        recurrenceRule: RecurrenceRule.NONE,
        isReimbursement: true,
        paidFor: {
          createMany: {
            data: [{ ledgerParticipantId: leg.to, shares: 1 }],
          },
        },
        notes: 'Auto-created when archiving the group.',
      },
    })
  }

  return { createdExpenses: legs.length }
}

const SETTLEMENT_ON_LEAVE_TITLE = 'Settlement on leave'

/**
 * Filter the optimal set of settlement legs down to the subset that
 * involves a specific ledger participant.
 */
export function getSettlementLegsForParticipant(
  balances: Balances,
  participantId: string,
): Reimbursement[] {
  return buildSettlementLegs(balances).filter(
    (leg) => leg.from === participantId || leg.to === participantId,
  )
}

/**
 * Create one reimbursement-style `Expense` per settlement leg that involves
 * `participantId`, scoped to a single participant.
 */
export async function createSettlementExpensesForLeave(
  groupId: string,
  participantId: string,
  actor: { accountId: string },
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<{ createdExpenses: number }> {
  const balances = await getGroupBalances(groupId)
  const legs = getSettlementLegsForParticipant(balances, participantId)
  if (legs.length === 0) return { createdExpenses: 0 }

  const group = await client.group.findUnique({
    where: { id: groupId },
    select: { ledgerId: true },
  })
  if (!group?.ledgerId) {
    throw new Error('Cannot settle balances: group has no ledger')
  }

  const now = new Date()
  for (const leg of legs) {
    if (leg.amount <= 0) continue
    const expenseId = randomId()
    await logActivity(
      groupId,
      ActivityType.CREATE_EXPENSE,
      {
        accountId: actor.accountId,
        ledgerParticipantId: participantId,
        expenseId,
        data: SETTLEMENT_ON_LEAVE_TITLE,
      },
      client,
    )
    await client.expense.create({
      data: {
        id: expenseId,
        ledgerId: group.ledgerId,
        expenseDate: now,
        title: SETTLEMENT_ON_LEAVE_TITLE,
        categoryId: PAYMENT_CATEGORY_ID,
        amount: leg.amount,
        paidBySplitMode: 'BY_AMOUNT',
        paidByList: {
          createMany: {
            data: [{ ledgerParticipantId: leg.from, shares: leg.amount }],
          },
        },
        splitMode: 'EVENLY',
        recurrenceRule: RecurrenceRule.NONE,
        isReimbursement: true,
        paidFor: {
          createMany: {
            data: [{ ledgerParticipantId: leg.to, shares: 1 }],
          },
        },
        notes: 'Auto-created when a member leaves the group.',
      },
    })
  }

  return { createdExpenses: legs.length }
}

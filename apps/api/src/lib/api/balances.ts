import { prisma, type Prisma } from '@spliit/db'
import {
  getBalances,
  getPublicBalances,
  getSuggestedSettlements,
  SETTLEMENT_CATEGORY_ID,
  toSecondPrecision,
  type Balances,
  type SuggestedSettlement,
} from '@spliit/domain'

import { buildExpenseActivityData, logActivity } from './activities'
import { getGroupBalanceExpenses } from './expenses'
import { toBalanceExpense } from './selects/balance-expense'
import { randomId } from './shared'

/** Compute the per-ledger-participant balance for every member of a group. */
export async function getGroupBalances(
  groupId: string,
  ledgerId?: string,
): Promise<Balances> {
  const rows = await getGroupBalanceExpenses(groupId, ledgerId)
  const expenses = rows.map(toBalanceExpense)
  const balances = getBalances(expenses)
  const suggestedSettlements = getSuggestedSettlements(balances)
  return getPublicBalances(suggestedSettlements)
}

/**
 * Returns `true` if any ledger participant in the balance map has a non-zero
 * total.
 */
export function hasUnsettledBalances(balances: Balances): boolean {
  for (const id in balances) {
    if (balances[id].total !== 0) return true
  }
  return false
}

export type SettlementActivityMeta = {
  activity: Awaited<ReturnType<typeof logActivity>>
  activityId: string
  expenseId: string
  title: string
  amount: number
  currencyCode: string | null
  date: string
  time: Date
}

const SETTLEMENT_TITLE = 'Settlement on archive'

/**
 * Build the optimal list of "settlement legs" (from, to, amount) that zero out
 * the group's balances.
 */
export function buildSettlementLegs(
  balances: Balances,
): SuggestedSettlement[] {
  return getSuggestedSettlements(balances)
}

/**
 * Create one settlement `Expense` per settlement leg produced by
 * {@link buildSettlementLegs}.
 */
export async function createSettlementExpensesForArchive(
  groupId: string,
  actor: { accountId: string },
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<{ createdExpenses: number; activities: SettlementActivityMeta[] }> {
  const balances = await getGroupBalances(groupId)
  if (!hasUnsettledBalances(balances)) {
    return { createdExpenses: 0, activities: [] }
  }

  const group = await client.group.findUnique({
    where: { id: groupId },
    select: { ledgerId: true, ledger: { select: { currencyCode: true } } },
  })
  if (!group?.ledgerId) {
    throw new Error('Cannot settle balances: group has no ledger')
  }

  const legs = buildSettlementLegs(balances)
  if (legs.length === 0) {
    return { createdExpenses: 0, activities: [] }
  }

  const now = new Date()
  const activities: SettlementActivityMeta[] = []
  for (const leg of legs) {
    if (leg.amount <= 0) continue
    const expenseId = randomId()
    const activity = await logActivity(
      groupId,
      {
        type: 'EXPENSE_CREATED',
        actor: { type: 'ACCOUNT', id: actor.accountId },
        subject: { type: 'EXPENSE', id: expenseId },
        data: buildExpenseActivityData({
          summary: SETTLEMENT_TITLE,
          title: SETTLEMENT_TITLE,
          amount: leg.amount,
          currencyCode: group.ledger.currencyCode ?? null,
          date: now.toISOString().slice(0, 10),
        }),
      },
      client,
    )
    activities.push({
      activity,
      activityId: activity.id,
      expenseId,
      title: SETTLEMENT_TITLE,
      amount: leg.amount,
      currencyCode: group.ledger.currencyCode ?? null,
      date: now.toISOString().slice(0, 10),
      time: activity.time,
    })
    await client.expense.create({
      data: {
        id: expenseId,
        ledgerId: group.ledgerId,
        createdByAccountId: actor.accountId,
        expenseDate: toSecondPrecision(now),
        expenseTimeZone: 'UTC',
        title: SETTLEMENT_TITLE,
        categoryId: SETTLEMENT_CATEGORY_ID,
        amount: leg.amount,
        paidBySplitMode: 'BY_AMOUNT',
        paidByList: {
          createMany: {
            data: [{ ledgerParticipantId: leg.from, shares: leg.amount }],
          },
        },
        splitMode: 'EVENLY',
        paidFor: {
          createMany: {
            data: [{ ledgerParticipantId: leg.to, shares: 1 }],
          },
        },
        notes: 'Auto-created when archiving the group.',
      },
    })
  }

  return { createdExpenses: legs.length, activities }
}

const SETTLEMENT_ON_LEAVE_TITLE = 'Settlement on leave'

/**
 * Filter the optimal set of settlement legs down to the subset that involves a
 * specific ledger participant.
 */
export function getSettlementLegsForParticipant(
  balances: Balances,
  participantId: string,
): SuggestedSettlement[] {
  return buildSettlementLegs(balances).filter(
    (leg) => leg.from === participantId || leg.to === participantId,
  )
}

/**
 * Create one settlement `Expense` per settlement leg that involves
 * `participantId`, scoped to a single participant.
 */
export async function createSettlementExpensesForLeave(
  groupId: string,
  participantId: string,
  actor: { accountId: string },
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<{ createdExpenses: number; activities: SettlementActivityMeta[] }> {
  const balances = await getGroupBalances(groupId)
  const legs = getSettlementLegsForParticipant(balances, participantId)
  if (legs.length === 0) return { createdExpenses: 0, activities: [] }

  const group = await client.group.findUnique({
    where: { id: groupId },
    select: { ledgerId: true, ledger: { select: { currencyCode: true } } },
  })
  if (!group?.ledgerId) {
    throw new Error('Cannot settle balances: group has no ledger')
  }

  const now = new Date()
  const activities: SettlementActivityMeta[] = []
  for (const leg of legs) {
    if (leg.amount <= 0) continue
    const expenseId = randomId()
    const activity = await logActivity(
      groupId,
      {
        type: 'EXPENSE_CREATED',
        actor: { type: 'ACCOUNT', id: actor.accountId },
        subject: { type: 'EXPENSE', id: expenseId },
        data: buildExpenseActivityData({
          summary: SETTLEMENT_ON_LEAVE_TITLE,
          title: SETTLEMENT_ON_LEAVE_TITLE,
          amount: leg.amount,
          currencyCode: group.ledger.currencyCode ?? null,
          date: now.toISOString().slice(0, 10),
        }),
      },
      client,
    )
    activities.push({
      activity,
      activityId: activity.id,
      expenseId,
      title: SETTLEMENT_ON_LEAVE_TITLE,
      amount: leg.amount,
      currencyCode: group.ledger.currencyCode ?? null,
      date: now.toISOString().slice(0, 10),
      time: activity.time,
    })
    await client.expense.create({
      data: {
        id: expenseId,
        ledgerId: group.ledgerId,
        createdByAccountId: actor.accountId,
        expenseDate: toSecondPrecision(now),
        expenseTimeZone: 'UTC',
        title: SETTLEMENT_ON_LEAVE_TITLE,
        categoryId: SETTLEMENT_CATEGORY_ID,
        amount: leg.amount,
        paidBySplitMode: 'BY_AMOUNT',
        paidByList: {
          createMany: {
            data: [{ ledgerParticipantId: leg.from, shares: leg.amount }],
          },
        },
        splitMode: 'EVENLY',
        paidFor: {
          createMany: {
            data: [{ ledgerParticipantId: leg.to, shares: 1 }],
          },
        },
        notes: 'Auto-created when a member leaves the group.',
      },
    })
  }

  return { createdExpenses: legs.length, activities }
}

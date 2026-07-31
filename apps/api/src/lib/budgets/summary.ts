import { prisma, type GroupBudget } from '@spliit/db'
import {
  calculateBudgetUsage,
  budgetSpentCutoff,
  getBudgetPeriodBounds,
  type BudgetRule,
} from '@spliit/domain'

import { budgetCategoryMatches } from './category-match'

export async function calculateBudgetSummary(budget: GroupBudget) {
  const rule: BudgetRule = {
    period: budget.period,
    amount: budget.amount,
    timeZone: budget.timeZone,
    customStartDate: budget.customStartDate,
    customEndDate: budget.customEndDate,
    categoryScope: budget.categoryScope,
    categoryNodeIds: budget.categoryNodeIds,
    participantScope: budget.participantScope,
    participantIds: budget.participantIds,
  }
  const bounds = getBudgetPeriodBounds(rule)
  const expenses = await prisma.expense.findMany({
    where: {
      ledgerId: budget.ledgerId,
      expenseDate: { gte: bounds.start, lte: bounds.end },
    },
    include: {
      paidFor: { include: { ledgerParticipant: true } },
      paidByList: { include: { ledgerParticipant: true } },
    },
  })
  const mapped = expenses.map((expense) => ({
    ...expense,
    paidFor: expense.paidFor.map((row) => ({
      shares: row.shares,
      participant: { id: row.ledgerParticipantId },
    })),
    paidByList: expense.paidByList.map((row) => ({
      shares: row.shares,
      participant: { id: row.ledgerParticipantId },
    })),
  }))
  const cutoff = budgetSpentCutoff(bounds)
  const used = calculateBudgetUsage(
    rule,
    mapped.filter(
      (expense) =>
        expense.expenseDate &&
        new Date(expense.expenseDate).getTime() <= cutoff.getTime(),
    ),
    bounds,
    {
      categoryMatches: budgetCategoryMatches,
    },
  )
  return {
    used,
    limit: budget.amount,
    remaining: budget.amount - used,
    from: bounds.start,
    to: bounds.end,
  }
}

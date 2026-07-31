import { randomUUID } from 'node:crypto'

import { prisma } from '@spliit/db'
import {
  budgetTrend,
  getBudgetLifecycle,
  getBudgetPeriodBounds,
} from '@spliit/domain'
import type { SpliitBoss } from '@spliit/jobs'

import { planBudgetAlertDeliveries } from '../notifications/budget-planner'
import { calculateBudgetSummary } from './summary'

/**
 * Evaluate active budgets. Delivery is intentionally delegated to the existing
 * notification pipeline.
 */
export async function evaluateBudgets(
  groupId?: string,
  boss: SpliitBoss | null = null,
) {
  const budgets = await prisma.groupBudget.findMany({
    where: { archived: false, ...(groupId ? { groupId } : {}) },
  })
  const results = []
  for (const budget of budgets) {
    const summary = await calculateBudgetSummary(budget)
    const bounds = getBudgetPeriodBounds({
      period: budget.period,
      amount: budget.amount,
      timeZone: budget.timeZone,
      customStartDate: budget.customStartDate,
      customEndDate: budget.customEndDate,
      categoryScope: budget.categoryScope,
      categoryNodeIds: budget.categoryNodeIds,
      participantScope: budget.participantScope,
      participantIds: budget.participantIds,
    })
    const status = budgetTrend(summary.used, budget.amount, bounds)
    if (getBudgetLifecycle({ period: budget.period }, bounds) !== 'ACTIVE') {
      results.push({ budgetId: budget.id, ...summary, ...status })
      continue
    }
    const alertType = status.over
      ? 'OVER'
      : status.trending
        ? 'TRENDING_OVER'
        : null
    if (
      alertType &&
      ((alertType === 'OVER' && budget.notifyOver) ||
        (alertType === 'TRENDING_OVER' && budget.notifyTrending))
    ) {
      await prisma.$transaction(async (tx) => {
        if (alertType === 'TRENDING_OVER') {
          const overAlert = await tx.groupBudgetAlert.findUnique({
            where: {
              budgetId_periodStart_alertType: {
                budgetId: budget.id,
                periodStart: bounds.start,
                alertType: 'OVER',
              },
            },
            select: { id: true },
          })
          if (overAlert) return
        }
        // Durable once-per-period guard: the unique (budgetId, periodStart,
        // alertType) constraint plus skipDuplicates makes this insert an atomic
        // claim. Concurrent evaluators (immediate expense-triggered job and the
        // daily cron) serialize on the row lock; exactly one wins count=1 and
        // plans deliveries, the rest get count=0 and bail without notifying.
        const created = await tx.groupBudgetAlert.createMany({
          data: [
            {
              id: randomUUID(),
              budgetId: budget.id,
              periodStart: bounds.start,
              alertType,
            },
          ],
          skipDuplicates: true,
        })
        if (!created.count) return
        const group = await tx.group.findUnique({
          where: { id: budget.groupId },
          select: { ledger: { select: { currencyCode: true } } },
        })
        await planBudgetAlertDeliveries({
          budget: {
            id: budget.id,
            groupId: budget.groupId,
            name: budget.name,
            amount: budget.amount,
            ledgerId: budget.ledgerId,
            participantScope: budget.participantScope,
            participantIds: budget.participantIds,
            periodStart: bounds.start,
            periodEnd: bounds.end,
            alertType,
            used: summary.used,
            currencyCode: group?.ledger.currencyCode ?? null,
            period: budget.period,
          },
          tx,
          boss,
        })
        await tx.groupBudgetAlert.updateMany({
          where: { budgetId: budget.id, periodStart: bounds.start, alertType },
          data: { deliveredAt: new Date() },
        })
      })
    }
    results.push({ budgetId: budget.id, ...summary, ...status })
  }
  return results
}

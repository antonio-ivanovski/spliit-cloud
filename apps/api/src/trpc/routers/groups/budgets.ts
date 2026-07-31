import { randomUUID } from 'node:crypto'

import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { prisma, type BudgetAlertType, type GroupBudget } from '@spliit/db'
import {
  budgetPeriodSchema,
  budgetScopeModeSchema,
  budgetDaysRemaining,
  budgetSpentCutoff,
  budgetTrend,
  calculateExpenseContribution,
  calculateBudgetUsage,
  budgetDaysUntilStart,
  getBudgetLifecycle,
  getBudgetPeriodBounds,
  getPreviousBudgetPeriodBounds,
  normalizeCategorySelection,
  normalizeCategoryId,
  type BudgetRule,
} from '@spliit/domain'

const MAX_BUDGET_EXPENSES = 50

import {
  mapExpenseListRow,
  type ExpenseListDbRow,
} from '../../../lib/api/expenses/queries'
import { groupExpenseListCardSelect } from '../../../lib/api/selects/expense-list'
import { budgetCategoryMatches } from '../../../lib/budgets/category-match'
import { loadGroupContext, protectedProcedure } from '../../init'
import { createTRPCRouter } from '../../init'
import {
  archiveBudgetOutputSchema,
  createBudgetOutputSchema,
  deleteBudgetOutputSchema,
  getBudgetOutputSchema,
  listBudgetsOutputSchema,
  updateBudgetOutputSchema,
} from '../../outputs/budgets'

const budgetInput = z.object({
  groupId: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  amount: z.number().int().positive().max(2_147_483_647),
  periodType: budgetPeriodSchema,
  customStart: z.coerce.date().nullable().optional(),
  customEnd: z.coerce.date().nullable().optional(),
  categoryScope: budgetScopeModeSchema.default('ALL'),
  categoryNodeIds: z.array(z.string().min(1)).default([]),
  participantScope: budgetScopeModeSchema.default('ALL'),
  participantIds: z.array(z.string().min(1)).default([]),
  notifyTrending: z.boolean().default(true),
  notifyOver: z.boolean().default(true),
})

const toRule = (budget: GroupBudget): BudgetRule => ({
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

async function validateParticipants(
  ledgerId: string,
  scope: 'ALL' | 'SELECTED',
  ids: string[],
) {
  if (scope === 'ALL') return
  if (ids.length === 0)
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Select at least one participant',
    })
  const rows = await prisma.ledgerParticipant.findMany({
    where: { ledgerId, id: { in: ids } },
    select: { id: true },
  })
  if (rows.length !== new Set(ids).size)
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Unknown budget participant',
    })
}

function normalizeBudgetCategoryIds(scope: 'ALL' | 'SELECTED', ids: string[]) {
  const unknown = ids.filter((id) => !normalizeCategoryId(id))
  if (unknown.length > 0) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Unknown category selection',
    })
  }
  const normalized = normalizeCategorySelection(ids)
  if (scope === 'SELECTED' && normalized.length === 0) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Select at least one category',
    })
  }
  return scope === 'SELECTED' ? normalized : []
}

async function summary(
  budget: GroupBudget,
  includeHistory = true,
  sharedCurrentRows?: ExpenseListDbRow[],
) {
  const rule = toRule(budget)
  const referenceAt = budget.archivedAt ?? new Date()
  const bounds = getBudgetPeriodBounds(rule, referenceAt)
  const rawRows =
    sharedCurrentRows?.filter(
      (expense) =>
        expense.expenseDate >= bounds.start &&
        expense.expenseDate <= bounds.end,
    ) ??
    (await prisma.expense.findMany({
      where: {
        ledgerId: budget.ledgerId,
        expenseDate: { gte: bounds.start, lte: bounds.end },
      },
      select: groupExpenseListCardSelect,
    }))
  const mappedRows = rawRows.map(mapExpenseListRow)
  /**
   * `mappedRows` follow the public expense-list shape but
   * `calculateExpenseContribution` expects `TotalsExpense` with `paidFor` /
   * `paidByList` entries shaped as `{ shares, participant: { id } }`. Project a
   * totals row per list row, keying by expense id.
   */
  const totalsById = new Map(
    mappedRows.map((row) => [
      row.id,
      {
        ...row,
        paidFor: row.paidFor.map((pf) => ({
          shares: pf.shares,
          participant: { id: pf.ledgerParticipant.id },
        })),
        paidByList: row.paidByList.map((pb) => ({
          shares: pb.shares,
          participant: { id: pb.ledgerParticipant.id },
        })),
      },
    ]),
  )
  const spentCutoff = budgetSpentCutoff(bounds, referenceAt)
  const matchingExpensesRaw = mappedRows
    .map((row) => {
      const totalsRow = totalsById.get(row.id)
      if (!totalsRow) return null
      return {
        row,
        contribution: calculateExpenseContribution(rule, totalsRow, bounds, {
          categoryMatches: budgetCategoryMatches,
        }),
      }
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry != null)
    .filter((entry) => entry.contribution > 0)
  const matchingExpensesAll = matchingExpensesRaw
    .filter(({ row }) => row.expenseDate <= spentCutoff)
    .sort(
      (a, b) =>
        new Date(b.row.expenseDate).getTime() -
        new Date(a.row.expenseDate).getTime(),
    )
    .map(({ row, contribution }) => ({ ...row, contribution }))
  const upcomingExpensesAll = budget.archivedAt
    ? []
    : matchingExpensesRaw
        .filter(({ row }) => row.expenseDate > spentCutoff)
        .sort(
          (a, b) =>
            new Date(a.row.expenseDate).getTime() -
            new Date(b.row.expenseDate).getTime(),
        )
        .map(({ row, contribution }) => ({ ...row, contribution }))
  const matchingExpensesTotal = matchingExpensesAll.length
  const upcomingExpensesTotal = upcomingExpensesAll.length
  const matchingExpenses = matchingExpensesAll.slice(0, MAX_BUDGET_EXPENSES)
  const upcomingExpenses = upcomingExpensesAll.slice(0, MAX_BUDGET_EXPENSES)
  const used = matchingExpensesAll.reduce(
    (sum, expense) => sum + expense.contribution,
    0,
  )
  const committed = upcomingExpensesAll.reduce(
    (sum, expense) => sum + expense.contribution,
    0,
  )
  const trend = budgetTrend(used, budget.amount, bounds, referenceAt)
  const daysRemaining = budgetDaysRemaining(bounds, referenceAt)
  const lifecycle = getBudgetLifecycle(rule, bounds, referenceAt)
  const daysUntilStart = budgetDaysUntilStart(bounds, referenceAt)

  const dailyByDate = new Map<string, { spent: number; committed: number }>()
  for (const { expenseDate, contribution } of matchingExpensesAll) {
    const key = new Date(expenseDate).toISOString().slice(0, 10)
    const entry = dailyByDate.get(key) ?? { spent: 0, committed: 0 }
    entry.spent += contribution
    dailyByDate.set(key, entry)
  }
  for (const { expenseDate, contribution } of upcomingExpensesAll) {
    const key = new Date(expenseDate).toISOString().slice(0, 10)
    const entry = dailyByDate.get(key) ?? { spent: 0, committed: 0 }
    entry.committed += contribution
    dailyByDate.set(key, entry)
  }
  const daily = [...dailyByDate.entries()].map(([date, values]) => ({
    date: new Date(`${date}T00:00:00.000Z`),
    ...values,
  }))
  const history: Array<{
    from: Date
    to: Date
    used: number
    limit: number
    remaining: number
    percentage: number
    projected: null
    trendStatus: 'OVER' | 'ON_TRACK'
  }> = []
  let previous = includeHistory
    ? getPreviousBudgetPeriodBounds(rule, bounds)
    : null
  const historyRows =
    includeHistory && previous
      ? await prisma.expense.findMany({
          where: {
            ledgerId: budget.ledgerId,
            expenseDate: {
              gte: new Date(
                bounds.start.getTime() -
                  (budget.period === 'YEARLY' ? 366 * 13 : 366) * 86400000,
              ),
              lte: bounds.end,
            },
          },
          select: groupExpenseListCardSelect,
        })
      : []
  for (let index = 0; index < 12 && previous; index++) {
    const period = previous
    if (period.end < budget.createdAt) break
    const priorExpenses = historyRows.filter(
      (expense) =>
        expense.expenseDate >= period.start &&
        expense.expenseDate <= period.end,
    )
    const priorMapped = priorExpenses.map(mapExpenseListRow)
    const priorTotals = priorMapped.map((row) => ({
      ...row,
      paidFor: row.paidFor.map((pf) => ({
        shares: pf.shares,
        participant: { id: pf.ledgerParticipant.id },
      })),
      paidByList: row.paidByList.map((pb) => ({
        shares: pb.shares,
        participant: { id: pb.ledgerParticipant.id },
      })),
    }))
    const priorUsed = calculateBudgetUsage(rule, priorTotals, period, {
      categoryMatches: budgetCategoryMatches,
    })
    history.push({
      from: period.start,
      to: period.end,
      used: priorUsed,
      limit: budget.amount,
      remaining: budget.amount - priorUsed,
      percentage: budget.amount ? (priorUsed / budget.amount) * 100 : 0,
      projected: null,
      trendStatus: priorUsed > budget.amount ? 'OVER' : 'ON_TRACK',
    })
    previous = getPreviousBudgetPeriodBounds(rule, period)
  }
  return {
    from: bounds.start,
    to: bounds.end,
    used,
    limit: budget.amount,
    remaining: budget.amount - used,
    percentage: budget.amount ? (used / budget.amount) * 100 : 0,
    projected: trend.projected,
    trendStatus: (trend.over
      ? 'OVER'
      : trend.trending
        ? 'TRENDING_OVER'
        : 'ON_TRACK') as 'OVER' | 'TRENDING_OVER' | 'ON_TRACK',
    daysRemaining,
    daysUntilStart,
    daysTotal: bounds.days,
    lifecycle,
    committed,
    matchingExpenses,
    upcomingExpenses,
    matchingExpensesTotal,
    upcomingExpensesTotal,
    daily,
    history,
  }
}

async function loadSharedCurrentRows(budgets: GroupBudget[]) {
  if (budgets.length === 0) return [] as ExpenseListDbRow[]
  const bounds = budgets.map((budget) =>
    getBudgetPeriodBounds(toRule(budget), budget.archivedAt ?? new Date()),
  )
  const from = new Date(
    Math.min(...bounds.map((period) => period.start.getTime())),
  )
  const to = new Date(Math.max(...bounds.map((period) => period.end.getTime())))
  return prisma.expense.findMany({
    where: {
      ledgerId: budgets[0]!.ledgerId,
      expenseDate: { gte: from, lte: to },
    },
    select: groupExpenseListCardSelect,
  })
}

function output(
  budget: GroupBudget,
  budgetSummary: Awaited<ReturnType<typeof summary>>,
) {
  return {
    id: budget.id,
    groupId: budget.groupId,
    ledgerId: budget.ledgerId,
    name: budget.name,
    amount: budget.amount,
    periodType: budget.period,
    timeZone: budget.timeZone,
    customStart: budget.customStartDate,
    customEnd: budget.customEndDate,
    categoryScope: budget.categoryScope,
    categoryNodeIds: budget.categoryNodeIds,
    participantScope: budget.participantScope,
    participantIds: budget.participantIds,
    notifyTrending: budget.notifyTrending,
    notifyOver: budget.notifyOver,
    archived: budget.archived,
    archivedAt: budget.archivedAt ?? null,
    createdAt: budget.createdAt,
    updatedAt: budget.updatedAt,
    summary: budgetSummary,
  }
}

async function establishAlertBaseline(
  budget: GroupBudget,
  currentSummary: Awaited<ReturnType<typeof summary>>,
  resetCurrentPeriod = false,
) {
  await prisma.$transaction(async (tx) => {
    if (resetCurrentPeriod) {
      await tx.groupBudgetAlert.deleteMany({
        where: {
          budgetId: budget.id,
          periodStart: currentSummary.from,
        },
      })
    }
    if (currentSummary.trendStatus === 'ON_TRACK') return
    await tx.groupBudgetAlert.createMany({
      data: [
        {
          id: randomUUID(),
          budgetId: budget.id,
          periodStart: currentSummary.from,
          alertType: currentSummary.trendStatus as BudgetAlertType,
          deliveredAt: new Date(),
        },
      ],
      skipDuplicates: true,
    })
  })
}

const list = protectedProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      includeArchived: z.boolean().optional(),
    }),
  )
  .output(listBudgetsOutputSchema)
  .query(async ({ input, ctx }) => {
    const { group } = await loadGroupContext({
      groupId: input.groupId,
      accountId: ctx.auth.user.id,
    })
    const budgets = await prisma.groupBudget.findMany({
      where: {
        groupId: group.id,
        ...(input.includeArchived ? {} : { archived: false }),
      },
      orderBy: { createdAt: 'desc' },
    })
    const sharedCurrentRows = await loadSharedCurrentRows(budgets)
    return {
      budgets: await Promise.all(
        budgets.map(async (budget) =>
          output(budget, await summary(budget, false, sharedCurrentRows)),
        ),
      ),
    }
  })

const get = protectedProcedure
  .input(z.object({ groupId: z.string().min(1), budgetId: z.string().min(1) }))
  .output(getBudgetOutputSchema)
  .query(async ({ input, ctx }) => {
    const { group } = await loadGroupContext({
      groupId: input.groupId,
      accountId: ctx.auth.user.id,
    })
    const budget = await prisma.groupBudget.findFirst({
      where: { id: input.budgetId, groupId: group.id },
    })
    if (!budget)
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Budget not found' })
    return { budget: output(budget, await summary(budget)) }
  })

const create = protectedProcedure
  .input(budgetInput)
  .output(createBudgetOutputSchema)
  .mutation(async ({ input, ctx }) => {
    const { group, member } = await loadGroupContext({
      groupId: input.groupId,
      accountId: ctx.auth.user.id,
    })
    if (member.role !== 'ADMIN')
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Only admins can manage budgets',
      })
    if (group.archived)
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Archived groups cannot change budgets',
      })
    if (
      input.periodType === 'CUSTOM' &&
      (!input.customStart || !input.customEnd)
    )
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Custom budgets require start and end dates',
      })
    if (input.periodType === 'CUSTOM' && input.customStart! > input.customEnd!)
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Custom budget start must be before end',
      })
    const categoryNodeIds = normalizeBudgetCategoryIds(
      input.categoryScope,
      input.categoryNodeIds,
    )
    await validateParticipants(
      group.ledgerId,
      input.participantScope,
      input.participantIds,
    )
    const preference = await prisma.accountPreference.findUnique({
      where: { accountId: ctx.auth.user.id },
      select: { timeZone: true },
    })
    // Snapshot the creator's timezone so every member sees the same period
    // boundaries. Fall back to UTC (the stored column default) when the account
    // has not initialized a timezone yet, rather than blocking budget creation.
    const timeZone = preference?.timeZone ?? 'UTC'
    const budget = await prisma.groupBudget.create({
      data: {
        id: randomUUID(),
        groupId: group.id,
        ledgerId: group.ledgerId,
        name: input.name,
        amount: input.amount,
        period: input.periodType,
        timeZone,
        customStartDate:
          input.periodType === 'CUSTOM' ? input.customStart : null,
        customEndDate: input.periodType === 'CUSTOM' ? input.customEnd : null,
        categoryScope: input.categoryScope,
        categoryNodeIds,
        participantScope: input.participantScope,
        participantIds: input.participantIds,
        notifyTrending: input.notifyTrending,
        notifyOver: input.notifyOver,
        createdByAccountId: ctx.auth.user.id,
      },
    })
    const currentSummary = await summary(budget)
    await establishAlertBaseline(budget, currentSummary)
    return { budget: output(budget, currentSummary) }
  })

const update = protectedProcedure
  .input(budgetInput.extend({ budgetId: z.string().min(1) }))
  .output(updateBudgetOutputSchema)
  .mutation(async ({ input, ctx }) => {
    const { group, member } = await loadGroupContext({
      groupId: input.groupId,
      accountId: ctx.auth.user.id,
    })
    if (member.role !== 'ADMIN')
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Only admins can manage budgets',
      })
    if (group.archived)
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Archived groups cannot change budgets',
      })
    const existing = await prisma.groupBudget.findFirst({
      where: { id: input.budgetId, groupId: group.id },
    })
    if (!existing)
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Budget not found' })
    if (
      input.periodType === 'CUSTOM' &&
      (!input.customStart ||
        !input.customEnd ||
        input.customStart > input.customEnd)
    )
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Invalid custom budget dates',
      })
    const categoryNodeIds = normalizeBudgetCategoryIds(
      input.categoryScope,
      input.categoryNodeIds,
    )
    await validateParticipants(
      group.ledgerId,
      input.participantScope,
      input.participantIds,
    )
    const budget = await prisma.groupBudget.update({
      where: { id: existing.id },
      data: {
        name: input.name,
        amount: input.amount,
        period: input.periodType,
        // Timezone is immutable: periods remain stable after edits.
        timeZone: existing.timeZone,
        customStartDate:
          input.periodType === 'CUSTOM' ? input.customStart : null,
        customEndDate: input.periodType === 'CUSTOM' ? input.customEnd : null,
        categoryScope: input.categoryScope,
        categoryNodeIds,
        participantScope: input.participantScope,
        participantIds: input.participantIds,
        notifyTrending: input.notifyTrending,
        notifyOver: input.notifyOver,
      },
    })
    const currentSummary = await summary(budget)
    await establishAlertBaseline(budget, currentSummary, true)
    return { budget: output(budget, currentSummary) }
  })

const archive = protectedProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      budgetId: z.string().min(1),
      archived: z.boolean(),
    }),
  )
  .output(archiveBudgetOutputSchema)
  .mutation(async ({ input, ctx }) => {
    const { group, member } = await loadGroupContext({
      groupId: input.groupId,
      accountId: ctx.auth.user.id,
    })
    if (member.role !== 'ADMIN')
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Only admins can manage budgets',
      })
    if (group.archived)
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Archived groups cannot change budgets',
      })
    const budget = await prisma.groupBudget.updateMany({
      where: { id: input.budgetId, groupId: group.id },
      data: {
        archived: input.archived,
        archivedAt: input.archived ? new Date() : null,
      },
    })
    if (budget.count === 0)
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Budget not found' })
    return { archived: input.archived }
  })

const remove = protectedProcedure
  .input(z.object({ groupId: z.string().min(1), budgetId: z.string().min(1) }))
  .output(deleteBudgetOutputSchema)
  .mutation(async ({ input, ctx }) => {
    const { group, member } = await loadGroupContext({
      groupId: input.groupId,
      accountId: ctx.auth.user.id,
    })
    if (member.role !== 'ADMIN')
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Only admins can manage budgets',
      })
    if (group.archived)
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Archived groups cannot change budgets',
      })
    const budget = await prisma.groupBudget.deleteMany({
      where: { id: input.budgetId, groupId: group.id },
    })
    if (budget.count === 0)
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Budget not found' })
    return { deleted: true as const }
  })

export const groupBudgetsRouter = createTRPCRouter({
  list,
  get,
  create,
  update,
  archive,
  delete: remove,
})

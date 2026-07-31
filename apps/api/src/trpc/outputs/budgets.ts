import { z } from 'zod'

import { budgetPeriodSchema, budgetScopeModeSchema } from '@spliit/domain'

import { expenseListItemResponseSchema } from './expenses'

const budgetTrendStatusSchema = z.enum(['ON_TRACK', 'TRENDING_OVER', 'OVER'])

const budgetMatchingExpenseSchema = expenseListItemResponseSchema.extend({
  contribution: z.number().int(),
})

const budgetHistoryPeriodSchema = z.object({
  from: z.date(),
  to: z.date(),
  used: z.number().int(),
  limit: z.number().int(),
  remaining: z.number().int(),
  percentage: z.number(),
  projected: z.null(),
  trendStatus: z.enum(['OVER', 'ON_TRACK']),
})

const budgetDailyPointSchema = z.object({
  date: z.date(),
  spent: z.number().int().nonnegative(),
  committed: z.number().int().nonnegative(),
})

/** Derived, always-recomputed period state for a budget. */
export const budgetSummarySchema = z.object({
  from: z.date(),
  to: z.date(),
  used: z.number().int(),
  limit: z.number().int(),
  remaining: z.number().int(),
  percentage: z.number(),
  projected: z.number().int(),
  trendStatus: budgetTrendStatusSchema,
  lifecycle: z.enum(['SCHEDULED', 'ACTIVE', 'COMPLETED']),
  daysRemaining: z.number().int().nonnegative(),
  daysUntilStart: z.number().int().nonnegative(),
  daysTotal: z.number().int().positive(),
  committed: z.number().int().nonnegative(),
  matchingExpenses: z.array(budgetMatchingExpenseSchema),
  upcomingExpenses: z.array(budgetMatchingExpenseSchema),
  matchingExpensesTotal: z.number().int().nonnegative(),
  upcomingExpensesTotal: z.number().int().nonnegative(),
  daily: z.array(budgetDailyPointSchema),
  history: z.array(budgetHistoryPeriodSchema),
})

/** Full budget DTO returned by list/get/create/update. */
export const budgetSchema = z.object({
  id: z.string(),
  groupId: z.string(),
  ledgerId: z.string(),
  name: z.string(),
  amount: z.number().int(),
  periodType: budgetPeriodSchema,
  timeZone: z.string(),
  customStart: z.date().nullable(),
  customEnd: z.date().nullable(),
  categoryScope: budgetScopeModeSchema,
  categoryNodeIds: z.array(z.string()),
  participantScope: budgetScopeModeSchema,
  participantIds: z.array(z.string()),
  notifyTrending: z.boolean(),
  notifyOver: z.boolean(),
  archived: z.boolean(),
  archivedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
  summary: budgetSummarySchema,
})

export const listBudgetsOutputSchema = z.object({
  budgets: z.array(budgetSchema),
})

export const getBudgetOutputSchema = z.object({ budget: budgetSchema })

export const createBudgetOutputSchema = z.object({ budget: budgetSchema })

export const updateBudgetOutputSchema = z.object({ budget: budgetSchema })

export const archiveBudgetOutputSchema = z.object({ archived: z.boolean() })

export const deleteBudgetOutputSchema = z.object({ deleted: z.literal(true) })

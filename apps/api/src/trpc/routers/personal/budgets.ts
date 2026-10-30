import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { prisma, type PersonalBudget } from '@spliit/db'
import {
  expandCategorySelection,
  normalizePersonalBudgetCategories,
  personalBudgetInputSchema,
  personalMonthSchema,
} from '@spliit/domain'

import { randomId } from '../../../lib/api/shared'
import { ensurePersonalProfile } from '../../../lib/personal/profile'
import { listPersonalBudgets } from '../../../lib/personal/queries'
import { createTRPCRouter, protectedProcedure } from '../../init'
import {
  deletePersonalBudgetOutputSchema,
  listPersonalBudgetsOutputSchema,
  personalBudgetMutationOutputSchema,
} from '../../outputs/personal'

function selectedCategories(budget: PersonalBudget): string[] {
  return budget.categoryScope === 'ALL'
    ? []
    : expandCategorySelection(budget.categoryIds)
}

function assertBudgetShape(input: {
  categoryScope: 'ALL' | 'SELECTED'
  categoryIds: string[]
}) {
  if (input.categoryScope === 'SELECTED' && input.categoryIds.length === 0) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Pick at least one category for a selected budget',
    })
  }
}

function assertNoOverlap(
  budgets: readonly PersonalBudget[],
  input: { categoryScope: 'ALL' | 'SELECTED'; categoryIds: string[] },
  currentId?: string,
) {
  if (input.categoryScope === 'ALL') {
    if (
      budgets.some(
        (budget) => budget.id !== currentId && budget.categoryScope === 'ALL',
      )
    ) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Only one overall personal budget can exist',
      })
    }
    return
  }

  const next = expandCategorySelection(input.categoryIds)
  for (const budget of budgets) {
    if (budget.id === currentId) continue
    if (budget.categoryScope === 'ALL') continue
    const other = selectedCategories(budget)
    if (next.some((categoryId) => other.includes(categoryId))) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Personal budgets cannot share a category',
      })
    }
  }
}

export const personalBudgetsRouter = createTRPCRouter({
  list: protectedProcedure
    .input(z.object({ month: personalMonthSchema.optional() }).optional())
    .output(listPersonalBudgetsOutputSchema)
    .query(async ({ input, ctx }) => {
      return listPersonalBudgets(ctx.auth.user.id, input?.month)
    }),

  create: protectedProcedure
    .input(personalBudgetInputSchema)
    .output(personalBudgetMutationOutputSchema)
    .mutation(async ({ input, ctx }) => {
      const accountId = ctx.auth.user.id
      if (input.startDay !== 1) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Custom budget start days are not supported yet',
        })
      }
      assertBudgetShape(input)
      const profile = await ensurePersonalProfile(accountId)
      const existing = await prisma.personalBudget.findMany({
        where: { accountId, archived: false },
      })
      assertNoOverlap(existing, input)

      const budget = await prisma.personalBudget.create({
        data: {
          id: randomId(),
          accountId,
          name: input.name,
          amount: input.amount,
          currencyCode: profile.currencyCode,
          period: 'MONTHLY',
          timeZone: profile.timeZone,
          categoryScope: input.categoryScope,
          categoryIds:
            input.categoryScope === 'ALL'
              ? []
              : normalizePersonalBudgetCategories(input.categoryIds),
          startDay: input.startDay,
        },
        select: { id: true },
      })
      return { id: budget.id }
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().min(1),
        budget: personalBudgetInputSchema,
      }),
    )
    .output(personalBudgetMutationOutputSchema)
    .mutation(async ({ input, ctx }) => {
      const accountId = ctx.auth.user.id
      if (input.budget.startDay !== 1) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Custom budget start days are not supported yet',
        })
      }
      assertBudgetShape(input.budget)
      const existing = await prisma.personalBudget.findFirst({
        where: { id: input.id, accountId, archived: false },
      })
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Budget not found' })
      }
      const budgets = await prisma.personalBudget.findMany({
        where: { accountId, archived: false },
      })
      assertNoOverlap(budgets, input.budget, input.id)

      await prisma.personalBudget.update({
        where: { id: input.id },
        data: {
          name: input.budget.name,
          amount: input.budget.amount,
          categoryScope: input.budget.categoryScope,
          categoryIds:
            input.budget.categoryScope === 'ALL'
              ? []
              : normalizePersonalBudgetCategories(input.budget.categoryIds),
          startDay: input.budget.startDay,
        },
      })
      return { id: input.id }
    }),

  archive: protectedProcedure
    .input(
      z.object({
        id: z.string().min(1),
        archived: z.boolean(),
      }),
    )
    .output(personalBudgetMutationOutputSchema)
    .mutation(async ({ input, ctx }) => {
      const result = await prisma.personalBudget.updateMany({
        where: { id: input.id, accountId: ctx.auth.user.id },
        data: {
          archived: input.archived,
          archivedAt: input.archived ? new Date() : null,
        },
      })
      if (result.count === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Budget not found' })
      }
      return { id: input.id }
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .output(deletePersonalBudgetOutputSchema)
    .mutation(async ({ input, ctx }) => {
      const result = await prisma.personalBudget.deleteMany({
        where: { id: input.id, accountId: ctx.auth.user.id },
      })
      if (result.count === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Budget not found' })
      }
      return { ok: true as const }
    }),
})

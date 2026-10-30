import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { prisma } from '@spliit/db'
import { SETTLEMENT_CATEGORY_ID, categoryIdSchema } from '@spliit/domain'
import { env as jobsEnv } from '@spliit/jobs'

import {
  applyCategorizationRun,
  confirmCalibrationRound,
  countPersonalUncategorizedExpenses,
  discardCategorizationRun,
  getCategorizationReviewPage,
  getCategorizationSaveConflicts,
  presentRun,
  retryCategorizationRun,
  rerunCategorizationRun,
  startPersonalCategorizationRun,
  updateRunSuggestions,
} from '../../../lib/api/bulk-categorization-run'
import {
  createTRPCRouter,
  enforceBulkAiRequestLimit,
  protectedProcedure,
} from '../../init'

const runInput = z.object({ runId: z.string().min(1) })
const revisionInput = runInput.extend({
  revision: z.number().int().nonnegative(),
})
const assignableCategorySchema = categoryIdSchema.refine(
  (id) => id !== SETTLEMENT_CATEGORY_ID,
)

async function requirePersonalRun(runId: string, accountId: string) {
  const run = await prisma.bulkCategorizationRun.findUnique({
    where: { id: runId },
  })
  if (!run) throw new TRPCError({ code: 'NOT_FOUND' })
  const scopeType = (run as unknown as { scopeType?: string }).scopeType
  const scopeId = (run as unknown as { scopeId?: string }).scopeId
  const personalAccountId = (
    run as unknown as { personalAccountId?: string | null }
  ).personalAccountId
  const isOwner =
    scopeType === 'PERSONAL' &&
    (scopeId === accountId || personalAccountId === accountId)
  if (!isOwner) throw new TRPCError({ code: 'NOT_FOUND' })
  return run
}

async function assertPersonalAiAllowed(
  accountId: string,
  mode: 'local' | 'system-one',
  resHeaders?: Headers,
) {
  if (mode !== 'system-one') return
  // Server-side AI gates (mirroring the group flow's deployment + preference
  // checks): System One must be configured, the account must not have opted
  // out of AI categorization, and the bulk AI bucket is charged.
  const { env } = await import('../../../lib/env')
  if (!env.AI_SYSTEM_ONE_API_KEY) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'System One is unavailable',
    })
  }
  const preference = await prisma.accountPreference.findUnique({
    where: { accountId },
    select: { aiFeaturesEnabled: true, aiCategoryExtractEnabled: true },
  })
  if (
    preference?.aiFeaturesEnabled === false ||
    preference?.aiCategoryExtractEnabled === false
  ) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'AI categorization is disabled for this account',
    })
  }
  enforceBulkAiRequestLimit(
    accountId,
    'personal.categorization.start',
    resHeaders,
  )
}

export const personalCategorizationRouter = createTRPCRouter({
  status: protectedProcedure.query(async ({ ctx }) => {
    const run = await prisma.bulkCategorizationRun.findUnique({
      where: {
        scopeType_scopeId: { scopeType: 'PERSONAL', scopeId: ctx.auth.user.id },
      },
    })
    return presentRun(run as never)
  }),

  count: protectedProcedure.query(async ({ ctx }) => {
    return countPersonalUncategorizedExpenses(ctx.auth.user.id)
  }),

  reviewPage: protectedProcedure
    .input(
      runInput.extend({
        cursor: z.number().int().nonnegative().optional(),
        limit: z.number().int().min(1).max(100).optional(),
        reviewCycle: z.string().nullable().optional(),
        filter: z.enum(['all', 'general']).default('all'),
      }),
    )
    .query(async ({ ctx, input }) => {
      await requirePersonalRun(input.runId, ctx.auth.user.id)
      return getCategorizationReviewPage(
        input.runId,
        input.cursor,
        input.limit,
        input.filter,
      )
    }),

  saveConflicts: protectedProcedure
    .input(runInput)
    .query(async ({ ctx, input }) => {
      await requirePersonalRun(input.runId, ctx.auth.user.id)
      return getCategorizationSaveConflicts(input.runId)
    }),

  start: protectedProcedure
    .input(
      z.object({
        mode: z.enum(['local', 'system-one']),
        locale: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!jobsEnv.JOBS_ENABLED) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Background jobs are unavailable',
        })
      }
      await assertPersonalAiAllowed(
        ctx.auth.user.id,
        input.mode,
        ctx.resHeaders,
      )
      return startPersonalCategorizationRun({
        accountId: ctx.auth.user.id,
        mode: input.mode,
        locale: input.locale ?? 'en-US',
      })
    }),

  edit: protectedProcedure
    .input(
      revisionInput.extend({
        changes: z
          .array(
            z.object({
              expenseId: z.string(),
              categoryId: assignableCategorySchema,
            }),
          )
          .max(2000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requirePersonalRun(input.runId, ctx.auth.user.id)
      return updateRunSuggestions(input.runId, input.revision, input.changes)
    }),

  save: protectedProcedure
    .input(
      revisionInput.extend({
        skipExpenseIds: z.array(z.string().min(1)).max(10_000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requirePersonalRun(input.runId, ctx.auth.user.id)
      // Personal runs never propagate series; ignore any series scopes.
      return applyCategorizationRun(
        input.runId,
        input.revision,
        ctx.auth.user.id,
        input.skipExpenseIds,
      )
    }),

  confirm: protectedProcedure
    .input(revisionInput)
    .mutation(async ({ ctx, input }) => {
      await requirePersonalRun(input.runId, ctx.auth.user.id)
      await confirmCalibrationRound(input.runId, input.revision)
      return { confirmed: true }
    }),

  rerun: protectedProcedure
    .input(revisionInput)
    .mutation(async ({ ctx, input }) => {
      await requirePersonalRun(input.runId, ctx.auth.user.id)
      await rerunCategorizationRun(input.runId, input.revision)
      return { queued: true }
    }),

  retry: protectedProcedure
    .input(revisionInput)
    .mutation(async ({ ctx, input }) => {
      await requirePersonalRun(input.runId, ctx.auth.user.id)
      await retryCategorizationRun(input.runId, input.revision)
      return { queued: true }
    }),

  discard: protectedProcedure
    .input(revisionInput)
    .mutation(async ({ ctx, input }) => {
      await requirePersonalRun(input.runId, ctx.auth.user.id)
      await discardCategorizationRun(input.runId, input.revision)
      return { discarded: true }
    }),
})

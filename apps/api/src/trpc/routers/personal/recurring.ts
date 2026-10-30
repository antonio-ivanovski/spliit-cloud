import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import {
  personalRecurringCreateSchema,
  personalRecurringUpdateSchema,
} from '@spliit/domain'

import {
  CREATE_OPERATIONS,
  createRequestIdSchema,
  runIdempotentCreate,
} from '../../../lib/api/idempotency'
import {
  cancelPersonalRecurringSeries,
  createPersonalRecurringSeries,
  deletePersonalRecurringSeries,
  getPersonalRecurringUpcoming,
  listPersonalRecurringSeries,
  pausePersonalRecurringSeries,
  resumePersonalRecurringSeries,
  skipNextPersonalRecurringOccurrence,
  updatePersonalRecurringSeries,
} from '../../../lib/personal/recurring'
import { createTRPCRouter, protectedProcedure } from '../../init'
import {
  listPersonalRecurringOutputSchema,
  personalRecurringMutationOutputSchema,
  personalRecurringResumeOutputSchema,
  personalRecurringSkipOutputSchema,
  personalRecurringUpcomingSchema,
} from '../../outputs/personal'

const upcomingInputSchema = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'invalidDate')
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'invalidDate')
    .optional(),
  seriesId: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(366).default(10),
})

export const personalRecurringRouter = createTRPCRouter({
  list: protectedProcedure
    .output(listPersonalRecurringOutputSchema)
    .query(async ({ ctx }) => {
      return listPersonalRecurringSeries(ctx.auth.user.id)
    }),

  create: protectedProcedure
    .input(
      z.object({
        requestId: createRequestIdSchema,
        series: personalRecurringCreateSchema,
      }),
    )
    .output(personalRecurringMutationOutputSchema)
    .mutation(async ({ input, ctx }) => {
      const accountId = ctx.auth.user.id
      const { value } = await runIdempotentCreate({
        accountId,
        operation: CREATE_OPERATIONS.personalRecurring,
        requestId: input.requestId,
        input,
        execute: async (tx) =>
          createPersonalRecurringSeries(accountId, input.series, tx),
      })
      return value
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().min(1),
        expectedVersion: z.number().int().positive().optional(),
        patch: personalRecurringUpdateSchema,
      }),
    )
    .output(personalRecurringMutationOutputSchema)
    .mutation(async ({ input, ctx }) => {
      if (
        'frequency' in (input.patch as Record<string, unknown>) ||
        'interval' in (input.patch as Record<string, unknown>) ||
        'anchorDate' in (input.patch as Record<string, unknown>)
      ) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Schedule fields are immutable after creation',
        })
      }
      return updatePersonalRecurringSeries(
        ctx.auth.user.id,
        input.id,
        input.patch,
        input.expectedVersion,
      )
    }),

  pause: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .output(personalRecurringMutationOutputSchema)
    .mutation(async ({ input, ctx }) => {
      return pausePersonalRecurringSeries(ctx.auth.user.id, input.id)
    }),

  resume: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .output(personalRecurringResumeOutputSchema)
    .mutation(async ({ input, ctx }) => {
      return resumePersonalRecurringSeries(ctx.auth.user.id, input.id)
    }),

  cancel: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .output(personalRecurringMutationOutputSchema)
    .mutation(async ({ input, ctx }) => {
      return cancelPersonalRecurringSeries(ctx.auth.user.id, input.id)
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .output(z.object({ ok: z.literal(true) }))
    .mutation(async ({ input, ctx }) => {
      return deletePersonalRecurringSeries(ctx.auth.user.id, input.id)
    }),

  skipNext: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .output(personalRecurringSkipOutputSchema)
    .mutation(async ({ input, ctx }) => {
      return skipNextPersonalRecurringOccurrence(ctx.auth.user.id, input.id)
    }),

  upcoming: protectedProcedure
    .input(upcomingInputSchema)
    .output(personalRecurringUpcomingSchema)
    .query(async ({ input, ctx }) => {
      return getPersonalRecurringUpcoming(ctx.auth.user.id, input)
    }),
})

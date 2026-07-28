import { z } from 'zod'

import { categoryIdSchema } from '@spliit/domain'

import { accountSummarySchema } from './common'

const statsPeriodSchema = z.object({
  from: z.date(),
  to: z.date(),
  granularity: z.enum(['DAY', 'WEEK', 'MONTH']),
  total: z.number().int(),
  expenseCount: z.number().int().nonnegative(),
})

const statsTimelineSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('bucket'),
    start: z.date(),
    categories: z.array(
      z.object({
        categoryId: categoryIdSchema,
        amount: z.number().int(),
      }),
    ),
    total: z.number().int(),
  }),
  z.object({
    type: z.literal('gap'),
    start: z.date(),
    end: z.date(),
  }),
])

export const getStatsOutputSchema = z.object({
  totalGroupSpendings: z.number().int(),
  totalParticipantSpendings: z.number().int(),
  totalParticipantShare: z.number().int(),
  activeParticipantId: z.string().nullable(),
  dashboard: z.object({
    lifetimeTotal: z.number().int(),
    period: statsPeriodSchema.nullable(),
    timeline: z.array(statsTimelineSchema),
    categories: z.array(
      z.object({
        categoryId: categoryIdSchema,
        amount: z.number().int(),
        percentage: z.number(),
      }),
    ),
    participants: z.array(
      z.object({
        participantId: z.string(),
        name: z.string(),
        account: accountSummarySchema.nullable(),
        amount: z.number().int(),
        percentage: z.number(),
      }),
    ),
  }),
})

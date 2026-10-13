import { z } from 'zod'

import { timeZoneSchema } from '@spliit/domain'

const dateOnlySchema = z.iso.date()

export const overviewStatsInputSchema = z
  .object({
    person: z
      .discriminatedUnion('kind', [
        z.object({ kind: z.literal('ME') }),
        z.object({ kind: z.literal('SHARED') }),
        z.object({ kind: z.literal('ACCOUNT'), accountId: z.string().min(1) }),
      ])
      .default({ kind: 'ME' }),
    scope: z.enum(['ALL', 'GROUPS', 'FRIENDS']).default('ALL'),
    groupIds: z.array(z.string().min(1)).max(100).optional(),
    period: z
      .enum([
        'WEEK',
        'MONTH',
        'LAST_MONTH',
        'QUARTER',
        'YEAR',
        'ALL_TIME',
        'CUSTOM',
      ])
      .default('MONTH'),
    timeZone: timeZoneSchema.default('UTC'),
    includeArchived: z.boolean().default(true),
    includeHidden: z.boolean().default(true),
    customRange: z
      .object({ from: dateOnlySchema, to: dateOnlySchema })
      .optional(),
  })
  .superRefine((input, ctx) => {
    if (input.period === 'CUSTOM' && !input.customRange) {
      ctx.addIssue({
        code: 'custom',
        path: ['customRange'],
        message: 'Custom period requires a date range',
      })
    }
    if (input.customRange && input.customRange.from > input.customRange.to) {
      ctx.addIssue({
        code: 'custom',
        path: ['customRange'],
        message: 'Custom range must end after it starts',
      })
    }
  })

const amountsSchema = z.object({
  expenses: z.number().int(),
  income: z.number().int(),
  netSpending: z.number().int(),
})

export const overviewStatsOutputSchema = z.object({
  filters: overviewStatsInputSchema,
  range: z.object({
    from: dateOnlySchema.nullable(),
    to: dateOnlySchema.nullable(),
  }),
  granularity: z.enum(['DAY', 'WEEK', 'MONTH']),
  coverage: z.object({
    eligibleLedgerCount: z.number().int().nonnegative(),
    unavailableLedgerCount: z.number().int().nonnegative(),
  }),
  currencies: z.array(
    amountsSchema.extend({
      key: z.string(),
      currency: z.string(),
      currencyCode: z.string().nullable(),
      transactionCount: z.number().int().nonnegative(),
      ledgerCount: z.number().int().nonnegative(),
      timeline: z.array(amountsSchema.extend({ date: dateOnlySchema })),
      categories: z.array(
        z.object({ categoryId: z.string(), amount: z.number().int() }),
      ),
      ledgers: z.array(
        amountsSchema.extend({ groupId: z.string(), name: z.string() }),
      ),
    }),
  ),
  people: z.array(z.object({ accountId: z.string(), name: z.string() })),
  groups: z.array(
    z.object({
      groupId: z.string(),
      name: z.string(),
      groupType: z.enum(['GROUP', 'FRIEND']),
    }),
  ),
})

export type OverviewStatsInput = z.infer<typeof overviewStatsInputSchema>
export type OverviewStatsOutput = z.infer<typeof overviewStatsOutputSchema>

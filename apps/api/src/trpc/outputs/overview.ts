import { z } from 'zod'

import { accountGroupSchema } from './account'
import { accountSummarySchema } from './common'

export const overviewFinancialStateSchema = z.enum([
  'NO_EXPENSES',
  'YOU_OWE',
  'OWED_TO_YOU',
  'SETTLED',
  'UNAVAILABLE',
])
export type OverviewFinancialState = z.infer<
  typeof overviewFinancialStateSchema
>

export const overviewGroupSchema = accountGroupSchema.extend({
  financialSummary: z.object({
    expenseCount: z.number().int().nonnegative(),
    netBalance: z.number().int().nullable(),
    state: overviewFinancialStateSchema,
    latestExpenseCreatedAt: z.string().nullable(),
  }),
  access: z.enum(['MEMBER', 'VIEW_ONLY']).default('MEMBER'),
  viewKey: z.string().nullable().default(null),
  lastOpenedAt: z.string().nullable().default(null),
})

export const overviewOutputSchema = z.object({
  stats: z.object({
    balanceSummaries: z.array(
      z.object({
        currency: z.string(),
        currencyCode: z.string().nullable(),
        owedToYou: z.number().int().nonnegative(),
        owedToYouGroupCount: z.number().int().nonnegative(),
        youOwe: z.number().int().nonnegative(),
        youOweGroupCount: z.number().int().nonnegative(),
      }),
    ),
    peopleBalances: z.array(
      z.object({
        key: z.string(),
        name: z.string(),
        account: accountSummarySchema.nullable(),
        currencies: z.array(
          z.object({
            currency: z.string(),
            currencyCode: z.string().nullable(),
            netAmount: z.number().int(),
            groups: z.array(
              z.object({
                groupId: z.string(),
                groupName: z.string(),
                amount: z.number().int(),
              }),
            ),
          }),
        ),
      }),
    ),
  }),
  groups: z.array(overviewGroupSchema),
})

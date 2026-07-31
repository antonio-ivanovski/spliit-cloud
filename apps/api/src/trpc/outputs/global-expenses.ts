import { z } from 'zod'

import { expenseListItemResponseSchema } from './expenses'

export const globalExpenseGroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  archived: z.boolean(),
  hidden: z.boolean(),
  groupType: z.enum(['GROUP', 'FRIEND']),
  displayName: z.string(),
  currency: z.string(),
  currencyCode: z.string().nullable(),
  participantCount: z.number().int().nonnegative(),
})

export const globalExpenseListItemSchema = expenseListItemResponseSchema.extend(
  {
    group: globalExpenseGroupSchema,
  },
)

export const globalExpensesListOutputSchema = z.object({
  expenses: z.array(globalExpenseListItemSchema),
  hasMore: z.boolean(),
  nextCursor: z.string().nullable(),
})

export const globalExpensePersonSchema = z.object({
  kind: z.enum(['account', 'participant']),
  id: z.string(),
  groupId: z.string().optional(),
  name: z.string(),
  groupName: z.string().optional(),
})

export const globalExpenseCurrencySchema = z.object({
  key: z.string(),
  currency: z.string(),
  currencyCode: z.string().nullable(),
})

export const globalExpensesFilterOptionsOutputSchema = z.object({
  groups: z.array(globalExpenseGroupSchema),
  people: z.array(globalExpensePersonSchema),
  currencies: z.array(globalExpenseCurrencySchema),
})

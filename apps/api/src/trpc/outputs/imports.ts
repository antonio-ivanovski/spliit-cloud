import { z } from 'zod'

import { recurrenceConfigSchema } from '@spliit/domain'

const normalizedSourceParticipantSchema = z.object({
  sourceId: z.string(),
  sourceName: z.string(),
})

const normalizedSourceExpenseSchema = z.object({
  title: z.string(),
  expenseDate: z.string(),
  category: z.string(),
  amountCurrency: z.string().nullable(),
  amount: z.number().int(),
  originalAmount: z.number().int().nullable(),
  originalCurrency: z.string().nullable(),
  conversionRate: z.number().nullable(),
  paidBySourceId: z.string(),
  paidBy: z.array(z.object({ sourceId: z.string(), shares: z.number().int() })),
  paidFor: z.array(
    z.object({ sourceId: z.string(), shares: z.number().int() }),
  ),
  splitMode: z.enum(['EVENLY', 'BY_SHARES', 'BY_PERCENTAGE', 'BY_AMOUNT']),
  recurrenceRule: z.enum(['NONE', 'DAILY', 'WEEKLY', 'MONTHLY']),
  recurrence: recurrenceConfigSchema.nullable().optional(),
  isReimbursement: z.boolean(),
  notes: z.string().nullable(),
})

export const normalizedSourceSchema = z.object({
  provider: z.enum(['SPLIIT', 'SPLITWISE']),
  sourceGroupId: z.string(),
  sourceUrl: z.string().nullable(),
  name: z.string(),
  currency: z.string(),
  currencyCode: z.string().nullable(),
  participants: z.array(normalizedSourceParticipantSchema),
  expenses: z.array(normalizedSourceExpenseSchema),
})

export const lookupGroupOutputSchema = z.object({
  status: z.literal('IMPORTABLE'),
  sourceProvider: z.literal('SPLIIT'),
  sourceUrl: z.string().url(),
  sourceGroupId: z.string(),
  source: normalizedSourceSchema,
})

export const importGroupOutputSchema = z.object({
  groupId: z.string(),
  ledgerId: z.string(),
  importedExpenses: z.number().int().nonnegative(),
  sourceGroupId: z.string().nullable(),
  invites: z.array(
    z.object({
      sourceName: z.string(),
      kind: z.enum(['EMAIL', 'LINK']),
      invitationId: z.string(),
      inviteUrl: z.string().url().optional(),
      email: z.string().email().optional(),
    }),
  ),
})

export const importPreviewOutputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('OK'), source: normalizedSourceSchema }),
  z.object({ kind: z.literal('NOT_FOUND') }),
  z.object({ kind: z.literal('ERROR'), message: z.string() }),
])

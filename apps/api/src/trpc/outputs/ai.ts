import { z } from 'zod'

import { categoryIdSchema } from '@spliit/domain'

export const extractExpenseInformationOutputSchema = z.object({
  amount: z.number().or(z.nan()),
  categoryId: categoryIdSchema.nullable(),
  currencyCode: z.string().nullable(),
  date: z.string().nullable(),
  title: z.string().nullable(),
  items: z.array(
    z.object({
      title: z.string(),
      unitPrice: z
        .number()
        .finite()
        .refine((value) => value !== 0),
      quantity: z.number().int().positive(),
    }),
  ),
})

export const extractExpenseInformationFromAudioOutputSchema = z.object({
  transcript: z.string().nullable(),
  groupId: z.string().min(1),
  title: z.string().nullable(),
  /** Decimal major units; normalized to ledger minor units in the preview. */
  amount: z.string().nullable(),
  currencyCode: z.string().nullable(),
  date: z.string().nullable(),
  categoryId: categoryIdSchema.nullable(),
  payerParticipantId: z.string().nullable(),
  participantIds: z.array(z.string()),
  issues: z.array(
    z.enum([
      'missingTitle',
      'missingAmount',
      'invalidDate',
      'unsupportedCurrency',
    ]),
  ),
})

import { categoryIdSchema } from '@spliit/domain'
import { z } from 'zod'

const confidenceSchema = z.enum(['high', 'medium', 'low'])

const categorySuggestionSchema = z.object({
  expenseId: z.string(),
  suggestedCategoryId: categoryIdSchema,
  confidence: confidenceSchema,
})

const calibrationResponseOutputSchema = z.object({
  needsFeedback: z.boolean(),
  selections: z.array(categorySuggestionSchema),
})

const candidateResponseSchema = z.object({
  id: z.string(),
  title: z.string(),
  expenseDate: z.date(),
  amount: z.number().int(),
})

export const extractCategoryOutputSchema = z.object({
  categoryId: categoryIdSchema,
})

export const extractExpenseInformationOutputSchema = z.object({
  amount: z.number().or(z.nan()),
  categoryId: categoryIdSchema.nullable(),
  currencyCode: z.string().nullable(),
  date: z.string().nullable(),
  title: z.string().nullable(),
  items: z.array(
    z.object({
      title: z.string(),
      unitPrice: z.number().positive(),
      quantity: z.number().int().positive(),
    }),
  ),
})

export const listBulkCategorizeCandidatesOutputSchema = z.object({
  totalEligible: z.number().int().nonnegative(),
  candidates: z.array(
    candidateResponseSchema.extend({
      categoryId: z.string(),
    }),
  ),
  capped: z.boolean(),
})

export const calibrateBulkCategorizeOutputSchema = z.object({
  candidates: z.array(candidateResponseSchema),
  totalEligible: z.number().int().nonnegative(),
  response: calibrationResponseOutputSchema,
  forcedReady: z.boolean(),
})

export const previewBulkCategorizeOutputSchema = z.object({
  suggestions: z.array(categorySuggestionSchema),
  targetIds: z.array(z.string()),
})

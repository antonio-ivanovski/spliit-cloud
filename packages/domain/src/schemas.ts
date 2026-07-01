import Decimal from 'decimal.js'

import * as z from 'zod'
import { categoryIdSchema } from './categories'
import type { RecurrenceRule, SplitMode } from './enums'

export const groupFormSchema = z
  .object({
    name: z.string().min(2, { error: 'min2' }).max(50, { error: 'max50' }),
    information: z.string().optional(),
    currency: z.string().min(1, { error: 'min1' }).max(5, { error: 'max5' }),
    currencyCode: z.union([z.string().length(3).nullish(), z.literal('')]), // ISO-4217 currency code
    participants: z
      .array(
        z.object({
          id: z.string().optional(),
          name: z
            .string()
            .min(2, { error: 'min2' })
            .max(50, { error: 'max50' }),
        }),
      )
      .min(1),
  })
  .superRefine(({ participants }, ctx) => {
    participants.forEach((participant, i) => {
      participants.slice(0, i).forEach((otherParticipant) => {
        if (otherParticipant.name === participant.name) {
          ctx.addIssue({
            code: 'custom',
            message: 'duplicateParticipantName',
            path: ['participants', i, 'name'],
          })
        }
      })
    })
  })

export type GroupFormValues = z.infer<typeof groupFormSchema>

const splitModeValues = [
  'EVENLY',
  'BY_SHARES',
  'BY_PERCENTAGE',
  'BY_AMOUNT',
  'ITEMIZED',
] as const satisfies readonly [SplitMode, ...SplitMode[]]
const splitModeSchema = z.enum(splitModeValues).default('EVENLY')

const paidBySplitModeSchema = z.enum(splitModeValues).default('BY_AMOUNT')

const recurrenceRuleValues = [
  'NONE',
  'DAILY',
  'WEEKLY',
  'MONTHLY',
] as const satisfies readonly [RecurrenceRule, ...RecurrenceRule[]]
const recurrenceRuleSchema = z.enum(recurrenceRuleValues).default('NONE')

const documentsSchema = z
  .array(
    z.object({
      id: z.string(),
      url: z.string().url(),
      width: z.number().int().min(1),
      height: z.number().int().min(1),
    }),
  )
  .default([])

// Row shape used by the form schema. `shares` is a number in user-facing
// units of the selected expense currency (the same currency as `amount`).
const formPaidForRowSchema = z.object({
  participant: z.string(),
  shares: z.number(),
})

const formPaidByRowSchema = z.object({
  participant: z.string(),
  shares: z.number(),
})

// Row shape used by the API/domain schema. Shares are integers: basis
// points for BY_PERCENTAGE, minor units for BY_AMOUNT, raw counts for
// BY_SHARES / EVENLY.
const apiPaidForRowSchema = z.object({
  participant: z.string(),
  shares: z.number().int(),
})

const apiPaidByRowSchema = z.object({
  participant: z.string(),
  shares: z.number().int(),
})

const itemSplitModeSchema = z
  .enum(['EVENLY', 'BY_SHARES', 'BY_PERCENTAGE', 'BY_AMOUNT'] as const)
  .default('EVENLY')

const itemFormPaidForRowSchema = z.object({
  participant: z.string(),
  shares: z.number(),
})

const itemApiPaidForRowSchema = z.object({
  participant: z.string(),
  shares: z.number().int(),
})

const itemRowDuplicateGuard = (
  rows: Array<{ participant: string }>,
  ctx: z.RefinementCtx,
) => {
  const seen = new Set<string>()
  rows.forEach((row, i) => {
    if (seen.has(row.participant)) {
      ctx.addIssue({
        code: 'custom',
        message: 'duplicateParticipant',
        path: [i, 'participant'],
      })
    } else {
      seen.add(row.participant)
    }
  })
}

export const expenseItemFormInputSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1, { error: 'itemTitleRequired' }),
  unitPrice: z.coerce
    .number()
    .refine((v) => !Number.isNaN(v), 'invalidNumber')
    .refine((v) => v > 0, 'itemAmountPositive')
    .refine((v) => v <= 10_000_000, 'amountTenMillion'),
  quantity: z.coerce.number().int().min(1, { error: 'itemQuantityMin1' }),
  paidFor: z
    .array(itemFormPaidForRowSchema)
    .min(0)
    .superRefine((paidFor, ctx) => {
      for (const { shares } of paidFor) {
        if (shares <= 0) {
          ctx.addIssue({
            code: 'custom',
            message: 'noZeroShares',
          })
        }
      }
      itemRowDuplicateGuard(paidFor, ctx)
    }),
  splitMode: itemSplitModeSchema,
})

export const expenseItemApiSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1, { error: 'itemTitleRequired' }),
  unitPrice: z.number().int().positive('itemAmountPositive'),
  quantity: z.number().int().min(1, { error: 'itemQuantityMin1' }),
  amount: z.number().int().positive('itemAmountPositive'),
  paidFor: z
    .array(itemApiPaidForRowSchema)
    .min(0)
    .superRefine((paidFor, ctx) => {
      for (const { shares } of paidFor) {
        if (shares <= 0) {
          ctx.addIssue({
            code: 'custom',
            message: 'noZeroShares',
          })
        }
      }
      itemRowDuplicateGuard(paidFor, ctx)
    }),
  splitMode: itemSplitModeSchema,
})

export type ExpenseFormItemValues = z.infer<typeof expenseItemFormInputSchema>
export type ExpenseApiItem = z.infer<typeof expenseItemApiSchema>

const itemizedRemainderFormSchema = z.object({
  paidFor: z
    .array(itemFormPaidForRowSchema)
    .min(0)
    .superRefine((paidFor, ctx) => {
      for (const { shares } of paidFor) {
        if (shares <= 0) {
          ctx.addIssue({
            code: 'custom',
            message: 'noZeroShares',
          })
        }
      }
      itemRowDuplicateGuard(paidFor, ctx)
    }),
  splitMode: itemSplitModeSchema,
})

const itemizedRemainderApiSchema = z.object({
  paidFor: z
    .array(itemApiPaidForRowSchema)
    .min(0)
    .superRefine((paidFor, ctx) => {
      for (const { shares } of paidFor) {
        if (shares <= 0) {
          ctx.addIssue({
            code: 'custom',
            message: 'noZeroShares',
          })
        }
      }
      itemRowDuplicateGuard(paidFor, ctx)
    }),
  splitMode: itemSplitModeSchema,
})

const paidByDuplicateGuard = (
  paidByList: Array<{ participant: string }>,
  ctx: z.RefinementCtx,
) => {
  const seen = new Set<string>()
  paidByList.forEach((row, i) => {
    if (seen.has(row.participant)) {
      ctx.addIssue({
        code: 'custom',
        message: 'duplicateParticipant',
        path: [i, 'participant'],
      })
    } else {
      seen.add(row.participant)
    }
  })
}

// paidByList BY_AMOUNT sum check, shared by both schemas. `paidByList`
// shares are in the selected expense currency (same units as `amount`).
const paidByAmountSumOk = (sum: Decimal, target: number): boolean =>
  sum.equals(new Decimal(target))

// `expenseFormInputSchema` validates the user-facing form values:
// numbers in display units (decimal major units for amounts,
// display percentages for BY_PERCENTAGE). Conversion to storage units
// happens in `submit-values.ts` before the values reach the API.
export const expenseFormInputSchema = z
  .object({
    expenseDate: z.coerce.date(),
    title: z
      .string({
        error: (issue) =>
          issue.input === undefined ? 'titleRequired' : undefined,
      })
      .min(2, { error: 'min2' }),
    category: categoryIdSchema,
    // Text inputs feed raw strings into react-hook-form; coerce at the
    // schema boundary so empty / numeric strings round-trip to numbers
    // before the major-unit refines run.
    amount: z.coerce
      .number()
      .refine((amount) => !Number.isNaN(amount), 'invalidNumber')
      .refine((amount) => amount != 0, 'amountNotZero')
      // Major-unit ceiling: $10,000,000 equivalent (matches the prior
      // 10_000_000_00 minor-unit ceiling; same error key for i18n).
      .refine((amount) => amount <= 10_000_000, 'amountTenMillion'),
    originalCurrency: z.union([z.string().length(3).nullish(), z.literal('')]),
    conversionRate: z.coerce
      .number()
      .refine((r) => !Number.isNaN(r), 'invalidNumber')
      .refine((r) => r > 0, 'ratePositive')
      .optional(),
    paidBySplitMode: paidBySplitModeSchema,
    paidByList: z
      .array(formPaidByRowSchema)
      .min(1, { error: 'paidByMin1' })
      .superRefine((paidByList, ctx) => {
        for (const { shares } of paidByList) {
          // Same negative-share rule the previous commit locked in:
          // allow negatives for negative-income expenses, reject only 0.
          if (shares === 0) {
            ctx.addIssue({
              code: 'custom',
              message: 'noZeroShares',
            })
          }
        }
        paidByDuplicateGuard(paidByList, ctx)
      }),
    paidFor: z
      .array(formPaidForRowSchema)
      .min(1, { error: 'paidForMin1' })
      .superRefine((paidFor, ctx) => {
        for (const { shares } of paidFor) {
          if (shares <= 0) {
            ctx.addIssue({
              code: 'custom',
              message: 'noZeroShares',
            })
          }
        }
      }),
    isMultiPayer: z.boolean().default(false),
    splitMode: splitModeSchema,
    saveDefaultSplittingOptions: z.boolean(),
    isReimbursement: z.boolean(),
    documents: documentsSchema,
    notes: z.string().optional(),
    recurrenceRule: recurrenceRuleSchema,
    items: z.array(expenseItemFormInputSchema).optional(),
    itemizedRemainder: itemizedRemainderFormSchema.optional(),
  })
  .superRefine((expense, ctx) => {
    switch (expense.splitMode) {
      case 'EVENLY':
        break
      case 'BY_SHARES':
        break
      case 'BY_AMOUNT': {
        const sum = expense.paidFor.reduce((sum, { shares }) => sum + shares, 0)
        // Two-decimal currencies can drift by ±0.01 due to rounding.
        if (Math.abs(sum - expense.amount) > 0.01) {
          ctx.addIssue({
            code: 'custom',
            message: 'amountSum',
            path: ['paidFor'],
          })
        }
        break
      }
      case 'BY_PERCENTAGE': {
        const sum = expense.paidFor.reduce((sum, { shares }) => sum + shares, 0)
        if (Math.abs(sum - 100) > 0.01) {
          ctx.addIssue({
            code: 'custom',
            message: 'percentageSum',
            path: ['paidFor'],
          })
        }
        break
      }
    }
    switch (expense.paidBySplitMode) {
      case 'EVENLY':
        break
      case 'BY_SHARES':
        break
      case 'BY_AMOUNT': {
        // paidBy shares are entered in the same currency as `amount` (the
        // selected expense currency), so the sum always compares to it.
        const sum = expense.paidByList.reduce(
          (sum, { shares }) => sum + shares,
          0,
        )
        if (Math.abs(sum - expense.amount) > 0.01) {
          ctx.addIssue({
            code: 'custom',
            message: 'paidByAmountSum',
            path: ['paidByList'],
          })
        }
        break
      }
      case 'BY_PERCENTAGE': {
        const sum = expense.paidByList.reduce(
          (sum, { shares }) => sum + shares,
          0,
        )
        if (Math.abs(sum - 100) > 0.01) {
          ctx.addIssue({
            code: 'custom',
            message: 'paidByPercentageSum',
            path: ['paidByList'],
          })
        }
        break
      }
    }
  })

/**
 * Shared cross-cutting item validations for both form and API schemas.
 * Ensures ITEMIZED mode has at least one item, no item with empty paidFor
 * in ITEMIZED mode, and items don't exceed the expense amount.
 */
export function validateExpenseItems(
  items: ExpenseApiItem[],
  amount: number,
  splitMode: string,
  ctx: z.RefinementCtx,
): void {
  if (splitMode === 'ITEMIZED' && items.length === 0) {
    ctx.addIssue({
      code: 'custom',
      message: 'itemizedRequiresItems',
      path: ['items'],
    })
    return
  }

  items.forEach((item, i) => {
    if (splitMode === 'ITEMIZED' && item.paidFor.length === 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'itemHasNoParticipants',
        path: ['items', i, 'paidFor'],
      })
    }
  })

  const itemsSum = items.reduce((sum, item) => sum + item.amount, 0)
  if (itemsSum > amount) {
    ctx.addIssue({
      code: 'custom',
      message: 'itemsExceedAmount',
      path: ['items'],
    })
  }
}

export type ExpenseFormInputValues = z.infer<typeof expenseFormInputSchema>

// `expenseApiSchema` validates the API/domain payload: amounts in
// integer minor units, BY_PERCENTAGE shares in basis points summing to
// 10000, BY_AMOUNT shares summing to amount in minor units. Used by
// the create/update/import tRPC procedures and the API helpers.
export const expenseApiSchema = z
  .object({
    expenseDate: z.coerce.date(),
    title: z.string().min(2, 'min2'),
    category: categoryIdSchema,
    amount: z
      .number()
      .int()
      .refine((amount) => amount != 0, 'amountNotZero')
      // 1,000,000,000 minor units = $10,000,000 (decimal_digits=2).
      // Same error key as the form schema's `amountTenMillion`.
      .refine((amount) => amount <= 1_000_000_000, 'amountTenMillion'),
    originalAmount: z
      .number()
      .int()
      .refine((amount) => amount != 0, 'amountNotZero')
      .refine((amount) => amount <= 1_000_000_000, 'amountTenMillion')
      .optional(),
    originalCurrency: z.union([z.string().length(3).nullish(), z.literal('')]),
    conversionRate: z
      .number()
      .refine((r) => r > 0, 'ratePositive')
      .optional(),
    paidBySplitMode: paidBySplitModeSchema,
    paidByList: z
      .array(apiPaidByRowSchema)
      .min(1, { error: 'paidByMin1' })
      .superRefine((paidByList, ctx) => {
        for (const { shares } of paidByList) {
          if (shares === 0) {
            ctx.addIssue({
              code: 'custom',
              message: 'noZeroShares',
            })
          }
        }
        paidByDuplicateGuard(paidByList, ctx)
      }),
    paidFor: z
      .array(apiPaidForRowSchema)
      .min(1, { error: 'paidForMin1' })
      .superRefine((paidFor, ctx) => {
        for (const { shares } of paidFor) {
          if (shares <= 0) {
            ctx.addIssue({
              code: 'custom',
              message: 'noZeroShares',
            })
          }
        }
      }),
    isMultiPayer: z.boolean().default(false),
    splitMode: splitModeSchema,
    saveDefaultSplittingOptions: z.boolean(),
    isReimbursement: z.boolean(),
    documents: documentsSchema,
    notes: z.string().optional(),
    recurrenceRule: recurrenceRuleSchema,
    items: z.array(expenseItemApiSchema).optional(),
    itemizedRemainder: itemizedRemainderApiSchema.optional(),
  })
  .superRefine((expense, ctx) => {
    switch (expense.splitMode) {
      case 'EVENLY':
        break
      case 'BY_SHARES':
        break
      case 'BY_AMOUNT': {
        const sum = expense.paidFor.reduce(
          (sum, { shares }) => new Decimal(shares).add(sum),
          new Decimal(0),
        )
        if (!sum.equals(new Decimal(expense.amount))) {
          ctx.addIssue({
            code: 'custom',
            message: 'amountSum',
            path: ['paidFor'],
          })
        }
        break
      }
      case 'BY_PERCENTAGE': {
        const sum = expense.paidFor.reduce((s, { shares }) => s + shares, 0)
        if (sum !== 10000) {
          ctx.addIssue({
            code: 'custom',
            message: 'percentageSum',
            path: ['paidFor'],
          })
        }
        break
      }
    }
    switch (expense.paidBySplitMode) {
      case 'EVENLY':
        break
      case 'BY_SHARES':
        break
      case 'BY_AMOUNT': {
        const target = expense.originalCurrency
          ? (expense.originalAmount ?? expense.amount)
          : expense.amount
        const sum = expense.paidByList.reduce(
          (sum, { shares }) => new Decimal(shares).add(sum),
          new Decimal(0),
        )
        if (!paidByAmountSumOk(sum, target)) {
          ctx.addIssue({
            code: 'custom',
            message: 'paidByAmountSum',
            path: ['paidByList'],
          })
        }
        break
      }
      case 'BY_PERCENTAGE': {
        const sum = expense.paidByList.reduce((s, { shares }) => s + shares, 0)
        if (sum !== 10000) {
          ctx.addIssue({
            code: 'custom',
            message: 'paidByPercentageSum',
            path: ['paidByList'],
          })
        }
        break
      }
    }
  })
  .superRefine((expense, ctx) => {
    const items = expense.items ?? []
    const itemsAmountTarget = expense.originalCurrency
      ? (expense.originalAmount ?? expense.amount)
      : expense.amount
    validateExpenseItems(items, itemsAmountTarget, expense.splitMode, ctx)
  })

export type Expense = z.infer<typeof expenseApiSchema>

export type SplittingOptions = {
  // Used for saving default splitting options in localStorage
  splitMode: SplitMode
  paidFor: ExpenseFormInputValues['paidFor'] | null
}

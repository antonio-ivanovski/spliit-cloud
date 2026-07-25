import * as z from 'zod'
import { categoryIdSchema } from './categories'
import {
  conversionSourceSchema,
  optionalExpenseConversionSchema,
} from './conversion'
import type { RecurrenceRule, SplitMode } from './enums'
import { recurrenceConfigSchema } from './recurring-expenses'

export const groupFormSchema = z
  .object({
    name: z.string().min(2, { error: 'min2' }).max(50, { error: 'max50' }),
    information: z.string().optional(),
    currency: z.string().min(1, { error: 'min1' }).max(5, { error: 'max5' }),
    currencyCode: z
      .union([z.string().length(3).nullish(), z.literal('')])
      .describe(
        'ISO-4217 3-letter code, or empty string for custom currencies',
      ),
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

// Friend-ledger creation form. The caller picks exactly one of three modes:
// known peer account, email (which may resolve to an existing account or a
// pending email invitation), or a shareable link. The exact-one invariant is
// enforced with a superRefine because Zod discriminated unions don't compose
// cleanly with `optional()` fields across all three paths.
export const friendFormSchema = z
  .object({
    peerAccountId: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Exactly one of peerAccountId, peerEmail, or useLink must be set.',
      ),
    peerEmail: z.string().email().optional(),
    temporaryName: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .optional()
      .describe(
        "Required when useLink is true; used as the friend's display name until they sign up.",
      ),
    useLink: z
      .boolean()
      .optional()
      .describe(
        'Create via shareable link. Exactly one of peerAccountId, peerEmail, or useLink must be set.',
      ),
    currency: z.string().min(1),
    currencyCode: z.string().optional(),
    information: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    const modes = [
      !!data.peerAccountId,
      !!data.peerEmail,
      !!data.useLink,
    ].filter(Boolean).length
    if (modes !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Select exactly one: a friend, an email, or a shareable link.',
        path: ['peerAccountId'],
      })
    }
    if (data.useLink && !data.temporaryName?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'temporaryName is required for link invites',
        path: ['temporaryName'],
      })
    }
  })

export type FriendFormValues = z.infer<typeof friendFormSchema>

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
// Shares are stored as raw user input (string) and coerced to number
// at validation time, matching the main `amount` field. This lets
// BY_AMOUNT inputs preserve intermediate decimal states like "10."
// while typing.
const formPaidForRowSchema = z.object({
  participant: z.string(),
  shares: z.coerce.number(),
})

const formPaidByRowSchema = z.object({
  participant: z.string(),
  shares: z.coerce.number(),
})

// Row shape used by the API/domain schema. Shares are integers: basis
// points for BY_PERCENTAGE, minor units for BY_AMOUNT, raw counts for
// BY_SHARES / EVENLY.
const apiPaidForRowSchema = z.object({
  participant: z.string(),
  shares: z
    .number()
    .int()
    .describe(
      'Units depend on splitMode: basis points for BY_PERCENTAGE (10000=100%), minor units for BY_AMOUNT, raw counts for BY_SHARES/EVENLY.',
    ),
})

const apiPaidByRowSchema = z.object({
  participant: z.string(),
  shares: z
    .number()
    .int()
    .describe(
      'Units depend on paidBySplitMode: basis points for BY_PERCENTAGE (10000=100%), minor units for BY_AMOUNT, raw counts for BY_SHARES/EVENLY.',
    ),
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
  shares: z
    .number()
    .int()
    .describe(
      'Units depend on the item splitMode: basis points for BY_PERCENTAGE (10000=100%), minor units for BY_AMOUNT, raw counts for BY_SHARES/EVENLY.',
    ),
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

// `defaultSplitSchema` is the persisted shape of a user's per-group
// default split. It captures the same data as an expense's `paidFor` +
// `splitMode`, expressed in the same units (BY_PERCENTAGE basis points,
// BY_AMOUNT minor units, BY_SHARES / EVENLY raw counts). ITEMIZED is
// not allowed — itemized splits involve an items array that is too
// shape-heavy to be a useful "default". The API rejects ITEMIZED writes
// and the UI hides the save action when the current split is itemized.
export const defaultSplitSchema = z
  .object({
    splitMode: z
      .enum(['EVENLY', 'BY_SHARES', 'BY_PERCENTAGE', 'BY_AMOUNT'])
      .describe('ITEMIZED is rejected — only flat split modes are allowed.'),
    paidFor: z
      .array(
        z.object({
          participant: z.string(),
          shares: z
            .number()
            .int()
            .describe(
              'Units depend on splitMode: basis points for BY_PERCENTAGE (10000=100%), minor units for BY_AMOUNT, raw counts for BY_SHARES/EVENLY.',
            ),
        }),
      )
      .min(1),
  })
  .superRefine((split, ctx) => {
    if (split.splitMode === 'BY_PERCENTAGE') {
      const sum = split.paidFor.reduce((s, { shares }) => s + shares, 0)
      if (sum !== 10000) {
        ctx.addIssue({
          code: 'custom',
          message: 'percentageSum',
          path: ['paidFor'],
        })
      }
    } else if (split.splitMode === 'BY_AMOUNT') {
      // BY_AMOUNT sums to the expense amount (minor units). We cannot
      // validate the sum here without the amount — the API enforces it
      // post-merge by checking against the persisted group base amount.
    }
    const seen = new Set<string>()
    split.paidFor.forEach((row, i) => {
      if (seen.has(row.participant)) {
        ctx.addIssue({
          code: 'custom',
          message: 'duplicateParticipant',
          path: ['paidFor', i, 'participant'],
        })
      } else {
        seen.add(row.participant)
      }
    })
  })

export type SavedDefaultSplit = z.infer<typeof defaultSplitSchema>

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
  unitPrice: z
    .number()
    .int()
    .positive('itemAmountPositive')
    .describe('Integer minor units of the expense currency.'),
  quantity: z.number().int().min(1, { error: 'itemQuantityMin1' }),
  amount: z
    .number()
    .int()
    .positive('itemAmountPositive')
    .describe('Integer minor units. Must equal unitPrice * quantity.'),
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
const paidByAmountSumOk = (sum: number, target: number): boolean =>
  sum === target

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
    // Form-local toggle: EXCHANGE | CUSTOM | undefined (undefined = group currency).
    // Mapped to the API `conversion` discriminant in submit-values.
    conversionType: conversionSourceSchema.optional(),
    paidBySplitMode: paidBySplitModeSchema,
    paidByList: z
      .array(formPaidByRowSchema)
      .min(1, { error: 'paidByMin1' })
      .superRefine((paidByList, ctx) => {
        paidByDuplicateGuard(paidByList, ctx)
      }),
    paidFor: z.array(formPaidForRowSchema).min(1, { error: 'paidForMin1' }),
    isMultiPayer: z.boolean().default(false),
    splitMode: splitModeSchema,
    isReimbursement: z.boolean(),
    documents: documentsSchema,
    notes: z.string().optional(),
    // Authoritative series cadence. `recurrenceRule` below remains accepted
    // for legacy imports until the API compatibility layer is removed.
    recurrence: recurrenceConfigSchema.nullish(),
    recurrenceRule: recurrenceRuleSchema,
    items: z.array(expenseItemFormInputSchema).optional(),
    itemizedRemainder: itemizedRemainderFormSchema.optional(),
  })
  .superRefine((expense, ctx) => {
    // A zero amount is already invalid at the amount field. Avoid reporting
    // the same state as a share-input problem while the user fixes it.
    if (expense.amount !== 0) {
      expense.paidByList.forEach(({ shares }, i) => {
        if (shares === 0) {
          ctx.addIssue({
            code: 'custom',
            message: 'noZeroShares',
            path: ['paidByList', i, 'shares'],
          })
        }
      })
      expense.paidFor.forEach(({ shares }, i) => {
        if (shares <= 0) {
          ctx.addIssue({
            code: 'custom',
            message: 'noZeroShares',
            path: ['paidFor', i, 'shares'],
          })
        }
      })
    }

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
// integer minor units (expense currency), BY_PERCENTAGE shares in basis
// points summing to 10000, BY_AMOUNT shares summing to amount. Conversion
// is optional — absent means same currency as the group/ledger base.
// Used by create/update/import tRPC procedures and the API helpers.
export const expenseApiSchema = z
  .object({
    expenseDate: z.coerce.date(),
    title: z.string().min(2, 'min2'),
    category: categoryIdSchema,
    // Expense-currency minor units (what the user typed). Server computes
    // the ledger-currency total from `conversion` when present.
    amount: z
      .number()
      .int()
      .refine((amount) => amount != 0, 'amountNotZero')
      // 1,000,000,000 minor units = $10,000,000 (decimal_digits=2).
      // Same error key as the form schema's `amountTenMillion`.
      .refine((amount) => amount <= 1_000_000_000, 'amountTenMillion')
      .describe(
        'Integer minor units of the expense currency (e.g. cents), not decimal. Max 1,000,000,000.',
      ),
    conversion: optionalExpenseConversionSchema.describe(
      'Optional FX conversion to the ledger base currency. Absent means same currency as the group.',
    ),
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
    isMultiPayer: z
      .boolean()
      .default(false)
      .describe(
        'Whether multiple participants paid. When false, paidByList must contain a single row.',
      ),
    splitMode: splitModeSchema,
    isReimbursement: z
      .boolean()
      .describe(
        'Marks a payment between participants rather than an expense. Excluded from spend stats.',
      ),
    documents: documentsSchema,
    notes: z.string().optional(),
    recurrence: recurrenceConfigSchema.nullish(),
    recurrenceRule: recurrenceRuleSchema,
    items: z.array(expenseItemApiSchema).optional(),
    itemizedRemainder: itemizedRemainderApiSchema
      .optional()
      .describe(
        'How the leftover amount (total minus item subtotals) is split across participants.',
      ),
  })
  .superRefine((expense, ctx) => {
    switch (expense.splitMode) {
      case 'EVENLY':
        break
      case 'BY_SHARES':
        break
      case 'BY_AMOUNT': {
        const sum = expense.paidFor.reduce((sum, { shares }) => sum + shares, 0)
        if (sum !== expense.amount) {
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
        // Shares are always in expense currency (= `amount`).
        const sum = expense.paidByList.reduce(
          (sum, { shares }) => sum + shares,
          0,
        )
        if (!paidByAmountSumOk(sum, expense.amount)) {
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
    // Items are always in expense currency (= `amount`).
    validateExpenseItems(items, expense.amount, expense.splitMode, ctx)
    // Exchange cannot price empty/custom codes — only ISO-ish codes.
    if (
      expense.conversion?.type === 'exchange' &&
      expense.conversion.currency.length !== 3
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'exchangeRequiresIsoCurrency',
        path: ['conversion', 'currency'],
      })
    }
  })

export type Expense = z.infer<typeof expenseApiSchema>

/**
 * Input to the admin bulk-categorize apply step. Each row pairs an
 * expense id with the destination category. The server validates that
 * the expense is eligible for the bulk operation (still on
 * `general`, scoped to the group's ledger, non-reimbursement, etc.)
 * before applying the change in a single transaction.
 */
export const bulkUpdateExpenseCategoriesInputSchema = z.object({
  groupId: z.string().min(1),
  fromCategoryId: categoryIdSchema
    .default(categoryIdSchema.options[0])
    .describe(
      "Recategorize expenses currently in this category. Defaults to 'general'.",
    ),
  triggeredByAiConfidence: z
    .boolean()
    .optional()
    .describe(
      'Whether this bulk update was triggered by an AI confidence workflow.',
    ),
  changes: z
    .array(
      z.object({
        expenseId: z.string().min(1),
        categoryId: categoryIdSchema,
      }),
    )
    .min(1)
    .max(2000),
})

export type BulkUpdateExpenseCategoriesInput = z.infer<
  typeof bulkUpdateExpenseCategoriesInputSchema
>

export type SplittingOptions = {
  // Used for saving default splitting options in localStorage
  splitMode: SplitMode
  paidFor: ExpenseFormInputValues['paidFor'] | null
}

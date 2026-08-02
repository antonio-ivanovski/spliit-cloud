import { z } from 'zod'

import { isValidDisplayShare } from '@spliit/domain'

const splitModeSchema = z.enum([
  'EVENLY',
  'BY_SHARES',
  'BY_PERCENTAGE',
  'BY_AMOUNT',
  'ITEMIZED',
])

const decimalStringSchema = z
  .string()
  .trim()
  .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/)
  .describe(
    'A positive decimal string in major currency units, for example 12.50',
  )

const allocationSchema = z.object({
  participantId: z
    .string()
    .describe('Stable participant ID from get-expense-context'),
  amount: decimalStringSchema.describe(
    'Exact amount paid by this participant, in the expense currency',
  ),
})

/**
 * The `prepare-expense` split contract. `BY_SHARES` accepts the same
 * display-unit values as the assistant API (0.01–1,000,000 with up to two
 * decimals); the API normalizes them to stored fixed units.
 */
export const beneficiarySplitSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('EVENLY').describe('Split equally'),
    participantIds: z
      .array(
        z.string().describe('Stable participant ID from get-expense-context'),
      )
      .min(1)
      .optional()
      .describe('Omit to split among all current participants'),
  }),
  z.object({
    mode: z
      .literal('BY_SHARES')
      .describe('Split by relative shares; decimals are allowed'),
    shares: z
      .array(
        z.object({
          participantId: z
            .string()
            .describe('Stable participant ID from get-expense-context'),
          shares: z
            .number()
            .positive()
            .refine(isValidDisplayShare, {
              message:
                'BY_SHARES value must be a positive decimal between 0.01 and 1,000,000 with at most two decimal places',
            })
            .describe(
              'Share weight. Decimals are allowed with up to two places, e.g. 0.5, 1.1, 25.75 (not hundredths).',
            ),
        }),
      )
      .min(1)
      .describe('Participant share weights'),
  }),
  z.object({
    mode: z
      .literal('BY_PERCENTAGE')
      .describe('Split by human percentages totaling 100'),
    shares: z
      .array(
        z.object({
          participantId: z
            .string()
            .describe('Stable participant ID from get-expense-context'),
          percentage: decimalStringSchema.describe(
            'Human percentage, e.g. 25 or 33.33; values must total 100',
          ),
        }),
      )
      .min(1)
      .describe('Participant percentage allocations'),
  }),
  z.object({
    mode: z
      .literal('BY_AMOUNT')
      .describe('Split by exact expense-currency amounts'),
    shares: z
      .array(allocationSchema)
      .min(1)
      .describe('Participant exact-amount allocations'),
  }),
])

const previewPersonSchema = z.object({
  participantId: z.string(),
  name: z.string(),
  shares: z.number().int(),
})

const previewSplitSchema = z.object({
  mode: splitModeSchema,
  participants: z.array(previewPersonSchema),
})

export const previewSchema = z.object({
  group: z.object({
    id: z.string(),
    name: z.string(),
    currency: z.string(),
    currencyCode: z.string().nullable(),
    decimalDigits: z.number().int().nonnegative(),
  }),
  expenseCurrency: z.object({
    code: z.string().nullable(),
    symbol: z.string(),
    decimalDigits: z.number().int().nonnegative(),
  }),
  title: z.string(),
  amountMinor: z.number().int(),
  amount: z.string(),
  date: z.iso.date(),
  category: z.string(),
  notes: z.string().nullable(),
  paidBy: z.array(previewPersonSchema),
  split: previewSplitSchema,
  items: z.array(
    z.object({
      lineId: z.string(),
      title: z.string(),
      unitPriceMinor: z.number().int(),
      quantity: z.number().int().positive(),
      amountMinor: z.number().int(),
      split: previewSplitSchema,
    }),
  ),
  remainder: z
    .object({
      amountMinor: z.number().int(),
      split: previewSplitSchema,
    })
    .nullable(),
  conversion: z
    .object({
      ledgerAmountMinor: z.number().int(),
      ledgerCurrencyCode: z.string().nullable(),
      ledgerCurrencySymbol: z.string(),
      ledgerDecimalDigits: z.number().int().nonnegative(),
      rate: z.number().nullable(),
    })
    .nullable(),
  defaults: z.array(
    z.object({
      field: z.string(),
      label: z.string(),
      value: z.string(),
    }),
  ),
})

export const expenseContextOutputSchema = z.object({
  connectedAccount: z.object({
    name: z.string(),
  }),
  categories: z.array(
    z.object({
      id: z.string(),
      grouping: z.string(),
      name: z.string(),
    }),
  ),
  totalGroups: z.number().int().nonnegative(),
  truncated: z.boolean(),
  groups: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      type: z.enum(['GROUP', 'FRIEND']),
      currency: z.string(),
      currencyCode: z.string().nullable(),
      callerParticipantId: z.string().nullable(),
      participantCount: z.number().int().nonnegative(),
      participants: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          status: z.enum(['ACTIVE', 'PENDING', 'UNLINKED']),
          isCaller: z.boolean(),
          disambiguationLabel: z.string(),
        }),
      ),
      disambiguationLabel: z.string(),
    }),
  ),
})

const groupSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['GROUP', 'FRIEND']),
  currency: z.string(),
  currencyCode: z.string().nullable(),
})

const recentExpenseParticipantSchema = z.object({
  ledgerParticipant: z.object({
    id: z.string(),
    name: z.string(),
    account: z
      .object({
        id: z.string(),
        name: z.string(),
        image: z.string().nullable(),
      })
      .nullable(),
    removed: z.boolean(),
  }),
  // BY_SHARES rows are returned as display decimals (e.g. 0.5 for stored 50);
  // other modes keep integers. Finite numbers accept both.
  shares: z.number().finite(),
})

export const groupSummaryOutputSchema = z.object({
  connectedAccount: z.object({
    name: z.string(),
  }),
  group: groupSchema,
  callerParticipantId: z.string().nullable(),
  participants: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      status: z.enum(['ACTIVE', 'PENDING_OR_UNLINKED']),
    }),
  ),
  defaultSplit: z
    .object({
      mode: z.enum(['EVENLY', 'BY_SHARES', 'BY_PERCENTAGE', 'BY_AMOUNT']),
      participants: z.array(
        z.object({
          participantId: z.string(),
          // BY_SHARES defaults are returned as display decimals (e.g. 0.5);
          // other modes keep integers. Finite numbers accept both.
          shares: z.number().finite(),
        }),
      ),
    })
    .nullable(),
  balances: z.record(
    z.string(),
    z.object({
      paid: z.number().int(),
      paidFor: z.number().int(),
      total: z.number().int(),
    }),
  ),
  recentExpenses: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      amount: z.number().int(),
      date: z.iso.date(),
      category: z.string(),
      paidBy: z.array(recentExpenseParticipantSchema),
      paidFor: z.array(recentExpenseParticipantSchema),
    }),
  ),
})

export const expensePreviewPropsSchema = z.object({
  preview: previewSchema,
  expenseUrlBase: z.url(),
})

export const expensePreviewMetadataSchema = z.object({
  confirmationToken: z.string().min(20),
})

export const prepareExpenseOutputSchema = expensePreviewPropsSchema

export const createExpenseOutputSchema = z.object({
  expenseId: z.string(),
  groupId: z.string(),
  alreadyCreated: z.boolean(),
  expenseUrl: z.url(),
})

export const mcpToolOutputSchemas = {
  'get-expense-context': expenseContextOutputSchema,
  'get-group-summary': groupSummaryOutputSchema,
  'prepare-expense': prepareExpenseOutputSchema,
  'create-expense': createExpenseOutputSchema,
} as const

export type ExpenseContextOutput = z.infer<typeof expenseContextOutputSchema>
export type GroupSummaryOutput = z.infer<typeof groupSummaryOutputSchema>
export type ExpensePreview = z.infer<typeof previewSchema>
export type ExpensePreviewProps = z.infer<typeof expensePreviewPropsSchema>
export type ExpensePreviewMetadata = z.infer<
  typeof expensePreviewMetadataSchema
>
export type CreateExpenseOutput = z.infer<typeof createExpenseOutputSchema>

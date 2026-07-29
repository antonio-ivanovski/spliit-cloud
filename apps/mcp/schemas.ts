import { z } from 'zod'

const splitModeSchema = z.enum([
  'EVENLY',
  'BY_SHARES',
  'BY_PERCENTAGE',
  'BY_AMOUNT',
  'ITEMIZED',
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
  shares: z.number().int(),
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
          shares: z.number().int(),
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

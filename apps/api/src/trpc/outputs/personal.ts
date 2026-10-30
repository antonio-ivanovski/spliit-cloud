import { z } from 'zod'

import { personalTransactionKindSchema } from '@spliit/domain'

export const personalProfileSchema = z.object({
  currencyCode: z.string(),
  timeZone: z.string(),
  sharedEnabled: z.boolean(),
  hasData: z.boolean(),
  canChangeCurrency: z.boolean(),
})

export const personalAttachmentSchema = z.object({
  id: z.string(),
  url: z.string(),
  fileName: z.string().nullable(),
  contentType: z.string().nullable(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  createdAt: z.string(),
})

export const personalEntrySchema = z.object({
  id: z.string(),
  kind: personalTransactionKindSchema,
  amount: z.number().int(),
  currencyCode: z.string(),
  originalAmount: z.number().int().nullable(),
  originalCurrency: z.string().nullable(),
  date: z.string(),
  categoryId: z.string(),
  title: z.string().nullable(),
  note: z.string().nullable(),
  version: z.number().int().positive(),
  source: z.enum(['PERSONAL', 'GROUP']),
  group: z
    .object({
      id: z.string(),
      name: z.string(),
    })
    .nullable(),
  canEdit: z.boolean(),
  attachments: z.array(personalAttachmentSchema),
  recurring: z
    .object({
      seriesId: z.string(),
      sequence: z.number().int().positive(),
    })
    .nullable(),
})

export const personalTotalsSchema = z.object({
  spent: z.number().int(),
  income: z.number().int(),
  count: z.number().int(),
})

export const listPersonalTransactionsOutputSchema = z.object({
  entries: z.array(personalEntrySchema),
  nextCursor: z.string().nullable(),
  totals: personalTotalsSchema,
})

export const createPersonalTransactionOutputSchema = z.object({
  id: z.string(),
})

export const updatePersonalTransactionOutputSchema = z.object({
  id: z.string(),
})

export const deletePersonalTransactionOutputSchema = z.object({
  ok: z.literal(true),
})

export const addPersonalAttachmentOutputSchema = personalAttachmentSchema

export const removePersonalAttachmentOutputSchema = z.object({
  ok: z.literal(true),
})

export const personalBudgetSchema = z.object({
  id: z.string(),
  name: z.string(),
  amount: z.number().int(),
  currencyCode: z.string(),
  period: z.literal('MONTHLY'),
  categoryScope: z.enum(['ALL', 'SELECTED']),
  categoryIds: z.array(z.string()),
  startDay: z.number().int(),
  archived: z.boolean(),
  spent: z.number().int(),
  remaining: z.number().int(),
  ratio: z.number(),
  projected: z.number().int(),
  state: z.enum(['OK', 'TRENDING', 'OVER']),
})

export const listPersonalBudgetsOutputSchema = z.object({
  budgets: z.array(personalBudgetSchema),
  overallBudget: personalBudgetSchema.nullable(),
})

export const personalBudgetMutationOutputSchema = z.object({
  id: z.string(),
})

export const deletePersonalBudgetOutputSchema = z.object({
  ok: z.literal(true),
})

export const personalOverviewSchema = z.object({
  month: z.string(),
  currencyCode: z.string(),
  spent: z.number().int(),
  income: z.number().int(),
  net: z.number().int(),
  previousSpent: z.number().int(),
  delta: z.number(),
  categories: z.array(
    z.object({
      categoryId: z.string(),
      amount: z.number().int(),
      percentage: z.number(),
    }),
  ),
  recent: z.array(personalEntrySchema),
  budgets: z.array(personalBudgetSchema),
  overallBudget: personalBudgetSchema.nullable(),
  shared: z.object({
    enabled: z.boolean(),
    count: z.number().int(),
    amount: z.number().int(),
    groups: z.array(
      z.object({
        groupId: z.string(),
        name: z.string(),
        count: z.number().int(),
        amount: z.number().int(),
      }),
    ),
  }),
})

export const personalSourceGroupSchema = z.object({
  groupId: z.string(),
  name: z.string(),
  type: z.enum(['GROUP', 'FRIEND']),
  included: z.boolean(),
  includeFrom: z.string().nullable(),
  memberCount: z.number().int(),
  expenseCount: z.number().int(),
})

export const listPersonalSourcesOutputSchema = z.object({
  profile: personalProfileSchema,
  groups: z.array(personalSourceGroupSchema),
})

export const updatePersonalGroupRuleOutputSchema = z.object({
  synced: z.number().int(),
})

export const setPersonalExpenseOverrideOutputSchema = z.object({
  included: z.boolean(),
})

export const reconcilePersonalOutputSchema = z.object({
  synced: z.number().int(),
})

export const personalSuggestCategoryOutputSchema = z.object({
  categoryId: z.string().nullable(),
  candidates: z.array(
    z.object({
      id: z.string(),
      score: z.number().min(0).max(1),
      source: z.literal('ai'),
    }),
  ),
})

export const personalExportOutputSchema = z.object({
  filename: z.string(),
  csv: z.string(),
  truncated: z.boolean(),
})

export const personalAutoCategorizeOutputSchema = z.object({
  scanned: z.number().int().nonnegative(),
  applied: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
})

export const personalExpenseStatusSchema = z.object({
  eligible: z.boolean(),
  included: z.boolean(),
  override: z.enum(['INCLUDE', 'EXCLUDE']).nullable(),
})

export const personalRecurringSeriesSchema = z.object({
  id: z.string(),
  status: z.enum(['ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED']),
  frequency: z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']),
  interval: z.number().int(),
  anchorDate: z.string(),
  nextOccurrenceDate: z.string(),
  nextOccurrenceOrdinal: z.number().int(),
  endType: z.enum(['INDEFINITE', 'COUNT', 'DATE']),
  occurrenceLimit: z.number().int().nullable(),
  endDate: z.string().nullable(),
  occurrencesCreated: z.number().int(),
  generatedCount: z.number().int(),
  kind: personalTransactionKindSchema,
  amount: z.number().int(),
  currencyCode: z.string(),
  categoryId: z.string(),
  title: z.string().nullable(),
  note: z.string().nullable(),
  version: z.number().int(),
  timeZone: z.string(),
})

export const listPersonalRecurringOutputSchema = z.object({
  series: z.array(personalRecurringSeriesSchema),
})

export const personalRecurringMutationOutputSchema = z.object({
  id: z.string(),
})

export const personalRecurringResumeOutputSchema = z.object({
  id: z.string(),
  skipped: z.number().int(),
})

export const personalRecurringSkipOutputSchema = z.object({
  id: z.string(),
  date: z.string(),
})

export const personalRecurringUpcomingSchema = z.object({
  occurrences: z.array(
    z.object({
      seriesId: z.string(),
      sequence: z.number().int(),
      date: z.string(),
      overdue: z.boolean(),
      kind: personalTransactionKindSchema,
      amount: z.number().int(),
      currencyCode: z.string(),
      categoryId: z.string(),
      title: z.string().nullable(),
    }),
  ),
})

const personalFileImportMatchSchema = z.object({
  key: z.string().min(1),
  kind: z.enum(['EXACT_IMPORT', 'EXISTING_TRANSACTION', 'CURRENT_FILE']),
  transactionId: z.string().nullable(),
  sourceRowId: z.string().nullable(),
  title: z.string().nullable(),
  date: z.string().nullable(),
  amount: z.number().int().nullable(),
  currency: z.string().nullable(),
  source: z.enum(['PERSONAL', 'GROUP']).nullable(),
})

export const personalFileImportDuplicatesOutputSchema = z.object({
  rows: z.array(
    z.object({
      rowId: z.string().min(1),
      rowNumber: z.number().int().positive(),
      matches: z.array(personalFileImportMatchSchema),
    }),
  ),
})

export const personalFileImportOutputSchema = z.object({
  importedCount: z.number().int().min(0),
  transactionIds: z.array(z.string().min(1)),
})

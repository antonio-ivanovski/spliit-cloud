import * as z from 'zod'

export const expenseChangedFields = [
  'title',
  'amount',
  'date',
  'category',
  'notes',
  'payers',
  'split',
  'items',
  'documents',
  'recurrence',
] as const
export const expenseChangedFieldSchema = z.enum(expenseChangedFields)
export type ExpenseChangedField = z.infer<typeof expenseChangedFieldSchema>

/** A single human-readable before/after change row for the activity feed. */
export const expenseActivityChangeSchema = z.object({
  field: expenseChangedFieldSchema,
  before: z.string().nullable().optional(),
  after: z.string().nullable().optional(),
})
export type ExpenseActivityChange = z.infer<typeof expenseActivityChangeSchema>

export const expenseActivityDataSchema = z.object({
  kind: z.literal('expense'),
  summary: z.string().optional(),
  title: z.string().optional(),
  // Amount is integer cents in the ledger base currency.
  amount: z.number().int().optional(),
  currencyCode: z.string().nullable().optional(),
  date: z.string().optional(),
  changedFields: z.array(expenseChangedFieldSchema).optional(),
  // Per-field before/after change rows for the activity feed.
  changes: z.array(expenseActivityChangeSchema).optional(),
  // Ledger participant IDs affected by the expense. Set for
  // EXPENSE_DELETED so the dispatcher can resolve recipients.
  affectedParticipants: z.array(z.string()).optional(),
})

export type ExpenseActivityData = z.infer<typeof expenseActivityDataSchema>

export const groupChangedFields = [
  'name',
  'information',
  'currency',
  'currencyCode',
  'linkedParticipant',
] as const
export const groupChangedFieldSchema = z.enum(groupChangedFields)
export type GroupChangedField = z.infer<typeof groupChangedFieldSchema>

export const groupActivityChangeSchema = z.object({
  field: groupChangedFieldSchema,
  before: z.string().nullable().optional(),
  after: z.string().nullable().optional(),
})
export type GroupActivityChange = z.infer<typeof groupActivityChangeSchema>

export const groupActivityDataSchema = z.object({
  kind: z.literal('group'),
  summary: z.string().optional(),
  changedFields: z.array(groupChangedFieldSchema).optional(),
  changes: z.array(groupActivityChangeSchema).optional(),
})

export type GroupActivityData = z.infer<typeof groupActivityDataSchema>

export const groupRoleSchema = z.enum(['ADMIN', 'MEMBER'])
export type GroupRole = z.infer<typeof groupRoleSchema>

export const memberActivityDataSchema = z.object({
  kind: z.literal('member'),
  summary: z.string().optional(),
  displayName: z.string().optional(),
  previousRole: groupRoleSchema.optional(),
  nextRole: groupRoleSchema.optional(),
  targetDisplayName: z.string().optional(),
})

export type MemberActivityData = z.infer<typeof memberActivityDataSchema>

export const invitationTypeSchema = z.enum(['EMAIL', 'LINK'])
export type InvitationType = z.infer<typeof invitationTypeSchema>

export const invitationActivityDataSchema = z.object({
  kind: z.literal('invitation'),
  summary: z.string().optional(),
  displayLabel: z.string().optional(),
  invitationType: invitationTypeSchema.optional(),
  role: groupRoleSchema.optional(),
})

export type InvitationActivityData = z.infer<
  typeof invitationActivityDataSchema
>

/**
 * Summary data for a bulk import of expenses (e.g. from Splitwise).
 * The activity log records one such row per import so the feed can show
 * "Alice imported 25 expenses from Splitwise" once instead of N rows,
 * while a single notification fan-outs to all affected active members.
 */
export const importSummaryActivityDataSchema = z.object({
  kind: z.literal('import_summary'),
  summary: z.string().optional(),
  count: z.number().int().nonnegative(),
  totalAmount: z.number().int().nonnegative().optional(),
  currencyCode: z.string().nullable().optional(),
  sourceProvider: z.string().optional(),
  // Ledger participant IDs affected by the imported expenses. Used by
  // the notification dispatcher to resolve recipients without having
  // to reload every expense from the DB.
  affectedParticipants: z.array(z.string()).optional(),
})

export type ImportSummaryActivityData = z.infer<
  typeof importSummaryActivityDataSchema
>

export const activityDataSchema = z.discriminatedUnion('kind', [
  expenseActivityDataSchema,
  groupActivityDataSchema,
  memberActivityDataSchema,
  invitationActivityDataSchema,
  importSummaryActivityDataSchema,
])

export type ActivityData = z.infer<typeof activityDataSchema>

/**
 * Safely parse an unknown value into an {@link ActivityData}. Returns
 * null for null/undefined inputs, non-object inputs, or values that
 * fail Zod validation. This lets the activity feed render a safe
 * fallback for legacy or malformed rows without crashing.
 */
export function parseActivityData(value: unknown): ActivityData | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'object') return null
  const result = activityDataSchema.safeParse(value)
  return result.success ? result.data : null
}

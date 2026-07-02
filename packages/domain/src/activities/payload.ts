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

export const expenseActivityDataSchema = z.object({
  kind: z.literal('expense'),
  summary: z.string().optional(),
  title: z.string().optional(),
  // Amount is integer cents in the ledger base currency.
  amount: z.number().int().optional(),
  currencyCode: z.string().nullable().optional(),
  date: z.string().optional(),
  changedFields: z.array(expenseChangedFieldSchema).optional(),
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
] as const
export const groupChangedFieldSchema = z.enum(groupChangedFields)
export type GroupChangedField = z.infer<typeof groupChangedFieldSchema>

export const groupActivityDataSchema = z.object({
  kind: z.literal('group'),
  summary: z.string().optional(),
  changedFields: z.array(groupChangedFieldSchema).optional(),
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

export const activityDataSchema = z.discriminatedUnion('kind', [
  expenseActivityDataSchema,
  groupActivityDataSchema,
  memberActivityDataSchema,
  invitationActivityDataSchema,
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

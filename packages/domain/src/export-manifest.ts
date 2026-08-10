import { z } from 'zod'

const sourceId = z.string().min(1)
const isoDateTime = z.iso.datetime()
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

const shareRow = z.object({
  participantId: sourceId,
  shares: z.number().int().nonnegative(),
})

const splitMode = z.enum([
  'EVENLY',
  'BY_SHARES',
  'BY_PERCENTAGE',
  'BY_AMOUNT',
  'ITEMIZED',
])

const item = z.object({
  sourceId,
  title: z.string(),
  unitPrice: z.number().int(),
  quantity: z.number().int(),
  amount: z.number().int(),
  splitMode,
  paidFor: z.array(shareRow),
  notes: z.string().nullable().optional(),
  createdAt: isoDateTime.nullable().optional(),
})

const itemizedRemainder = z.object({ splitMode, paidFor: z.array(shareRow) })

export const exportDocumentSchema = z.object({
  sourceId,
  fileName: z.string().nullable(),
  contentType: z.string().nullable(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  path: z.string().nullable(),
  status: z.enum(['INCLUDED', 'MISSING']),
  sizeBytes: z.number().int().nonnegative().nullable(),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
})

const comment = z.object({
  sourceId,
  authorName: z.string(),
  text: z.string(),
  createdAt: isoDateTime,
})

const expense = z.object({
  sourceId,
  createdAt: isoDateTime,
  expenseDate: dateOnly,
  title: z.string(),
  categoryId: z.string(),
  amount: z.number().int().nonnegative(),
  originalAmount: z.number().int().nullable(),
  originalCurrency: z.string().nullable(),
  conversionRate: z.number().nullable(),
  conversionSource: z.enum(['EXCHANGE', 'CUSTOM']).nullable(),
  paidBySplitMode: splitMode,
  isReimbursement: z.boolean(),
  splitMode,
  version: z.number().int().positive(),
  createdByParticipantId: sourceId.nullable(),
  recurringSeriesId: sourceId.nullable(),
  recurrenceSequence: z.number().int().positive().nullable(),
  notes: z.string().nullable(),
  paidByList: z.array(shareRow),
  paidFor: z.array(shareRow),
  items: z.array(item),
  itemizedRemainder: itemizedRemainder.nullable(),
  documents: z.array(exportDocumentSchema),
  comments: z.array(comment),
})

const recurrenceSeries = z.object({
  sourceId,
  creatorParticipantId: sourceId.nullable(),
  timeZone: z.string(),
  frequency: z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']),
  interval: z.number().int().positive(),
  anchorDate: dateOnly,
  anchorSequence: z.number().int().positive(),
  nextOccurrenceDate: dateOnly,
  nextOccurrenceOrdinal: z.number().int().positive(),
  endType: z.enum(['INDEFINITE', 'COUNT', 'DATE']),
  occurrenceLimit: z.number().int().positive().nullable(),
  endDate: dateOnly.nullable(),
  occurrencesCreated: z.number().int().nonnegative(),
  status: z.enum(['ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED']),
  template: z.unknown(),
  version: z.number().int().positive(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
})

const membership = z.object({
  role: z.enum(['ADMIN', 'MEMBER']),
  status: z.enum(['PENDING', 'ACTIVE', 'LEFT', 'REMOVED', 'SUSPENDED']),
  joinedAt: isoDateTime.nullable(),
  leftAt: isoDateTime.nullable(),
})

const participant = z.object({
  sourceId,
  kind: z.enum(['ACCOUNT_MEMBER', 'UNLINKED_PARTICIPANT']),
  displayName: z.string(),
  removedAt: isoDateTime.nullable(),
  membership: membership.nullable(),
})

const subgroup = z.object({
  sourceId,
  name: z.string(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  participantIds: z.array(sourceId),
})

const budget = z.object({
  sourceId,
  name: z.string(),
  amount: z.number().int().nonnegative(),
  period: z.enum(['WEEKLY', 'MONTHLY', 'YEARLY', 'CUSTOM']),
  timeZone: z.string(),
  customStartDate: dateOnly.nullable(),
  customEndDate: dateOnly.nullable(),
  categoryScope: z.enum(['ALL', 'SELECTED']),
  categoryNodeIds: z.array(z.string()),
  participantScope: z.enum(['ALL', 'SELECTED']),
  participantIds: z.array(sourceId),
  notifyTrending: z.boolean(),
  notifyOver: z.boolean(),
  archived: z.boolean(),
  archivedAt: isoDateTime.nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
})

export const exportWarningSchema = z.object({
  type: z.literal('MISSING_DOCUMENT'),
  documentId: sourceId,
  path: z.string().nullable(),
})

/**
 * The portable data for one group, independent of the container that carries
 * it. Account-wide exports can reuse this shape while applying a group-specific
 * archive path prefix to its documents.
 */
export const spliitGroupExportSnapshotSchema = z.object({
  complete: z.boolean(),
  warnings: z.array(exportWarningSchema),
  group: z.object({
    sourceId,
    name: z.string(),
    information: z.string().nullable(),
    archived: z.boolean(),
    groupType: z.enum(['GROUP', 'FRIEND']),
    subgroupsEnabled: z.boolean(),
    createdAt: isoDateTime,
    ledger: z.object({
      sourceId,
      currency: z.string(),
      currencyCode: z.string().nullable(),
      createdAt: isoDateTime,
    }),
  }),
  participants: z.array(participant),
  subgroups: z.array(subgroup),
  budgets: z.array(budget),
  recurrenceSeries: z.array(recurrenceSeries),
  expenses: z.array(expense),
  orphanDocuments: z.array(exportDocumentSchema),
})

export const spliitGroupExportManifestSchema = z.object({
  format: z.literal('spliit.cloud/export'),
  version: z.literal(1),
  scope: z.object({ type: z.literal('GROUP'), sourceId }),
  exportedAt: isoDateTime,
  ...spliitGroupExportSnapshotSchema.shape,
})

export type SpliitExportDocument = z.infer<typeof exportDocumentSchema>
export type SpliitGroupExportSnapshot = z.infer<
  typeof spliitGroupExportSnapshotSchema
>

export type SpliitGroupExportManifest = z.infer<
  typeof spliitGroupExportManifestSchema
>

import { z } from 'zod'

import { accountPreferenceSchema } from './account-preferences'
import {
  notificationCategorySchema,
  notificationChannelsSchema,
} from './notifications'

const sourceId = z.string().min(1)
const isoDateTime = z.iso.datetime()
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

const shareRow = z.object({
  participantId: sourceId,
  shares: z.number().int().nonnegative(),
})

const recurringShareRow = z.object({
  ledgerParticipantId: sourceId,
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

// Keep recurrence templates explicitly allow-listed. They are stored as JSON
// in the database; passing unknown keys through could export future operational
// values (tokens, hashes, or credentials) by accident.
const recurringTemplate = z.object({
  title: z.string(),
  categoryId: z.string(),
  amount: z.number().int(),
  originalAmount: z.number().int().nullable(),
  originalCurrency: z.string().nullable(),
  conversionRate: z.number().nullable(),
  conversionSource: z.enum(['EXCHANGE', 'CUSTOM']).nullable(),
  paidBySplitMode: splitMode,
  paidByList: z.array(recurringShareRow),
  paidFor: z.array(recurringShareRow),
  splitMode,
  isReimbursement: z.boolean(),
  notes: z.string().nullable(),
  items: z.array(
    z.object({
      title: z.string(),
      unitPrice: z.number().int(),
      quantity: z.number().int(),
      amount: z.number().int(),
      splitMode,
      paidFor: z.array(recurringShareRow),
    }),
  ),
  itemizedRemainder: z
    .object({ splitMode, paidFor: z.array(recurringShareRow) })
    .nullable(),
})

export const exportDocumentSchema = z.object({
  sourceId,
  fileName: z.string().nullable(),
  contentType: z.string().nullable(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  path: z.string().nullable(),
  status: z.enum(['INCLUDED', 'MISSING', 'OMITTED']),
  sizeBytes: z.number().int().nonnegative().nullable(),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
})

const comment = z.object({
  sourceId,
  authorName: z.string(),
  authorParticipantId: sourceId.nullable().optional(),
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
  template: recurringTemplate,
  version: z.number().int().positive(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
})

const membership = z.object({
  role: z.enum(['ADMIN', 'MEMBER']),
  status: z.enum(['PENDING', 'ACTIVE', 'LEFT', 'REMOVED', 'SUSPENDED']),
  joinedAt: isoDateTime.nullable(),
  leftAt: isoDateTime.nullable(),
  createdAt: isoDateTime.nullable().optional(),
  updatedAt: isoDateTime.nullable().optional(),
})

const participant = z.object({
  sourceId,
  kind: z.enum(['ACCOUNT_MEMBER', 'UNLINKED_PARTICIPANT']),
  displayName: z.string(),
  identity: z
    .discriminatedUnion('kind', [
      z.object({
        kind: z.literal('ACCOUNT'),
        accountId: sourceId,
        name: z.string(),
        email: z.string().nullable(),
      }),
      z.object({
        kind: z.literal('EMAIL'),
        email: z.string().email(),
      }),
    ])
    .nullable()
    .optional(),
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

export const accountExportGroupSectionValues = [
  'GROUPS',
  'FRIENDS',
  'STARRED',
  'ARCHIVED',
  'HIDDEN',
] as const

export const accountExportGroupSectionSchema = z.enum(
  accountExportGroupSectionValues,
)

export const accountExportSelectionSchema = z.object({
  sections: z.object({
    GROUPS: z.boolean(),
    FRIENDS: z.boolean(),
    STARRED: z.boolean(),
    ARCHIVED: z.boolean(),
    HIDDEN: z.boolean(),
  }),
  groupOverrides: z
    .array(
      z.object({
        groupSourceId: sourceId,
        included: z.boolean(),
      }),
    )
    .max(10_000)
    .superRefine((overrides, ctx) => {
      const ids = new Set<string>()
      overrides.forEach((override, index) => {
        if (ids.has(override.groupSourceId)) {
          ctx.addIssue({
            code: 'custom',
            message: 'Duplicate group override.',
            path: [index, 'groupSourceId'],
          })
        }
        ids.add(override.groupSourceId)
      })
    }),
  includeDocuments: z.boolean(),
  includeAccountPreferences: z.boolean(),
  includeGroupPreferences: z.boolean(),
})

export const defaultAccountExportSelection = {
  sections: {
    GROUPS: true,
    FRIENDS: true,
    STARRED: true,
    ARCHIVED: false,
    HIDDEN: false,
  },
  groupOverrides: [],
  includeDocuments: true,
  includeAccountPreferences: true,
  includeGroupPreferences: true,
} as const satisfies z.input<typeof accountExportSelectionSchema>

export const accountExportIdentitySchema = z.object({
  sourceId,
  name: z.string(),
  email: z.string().email().nullable(),
})

const accountExportNotificationPreferenceSchema = z.object({
  category: notificationCategorySchema,
  channels: notificationChannelsSchema,
})

const accountExportDefaultSplitSchema = z.object({
  splitMode: z.enum(['EVENLY', 'BY_SHARES', 'BY_PERCENTAGE', 'BY_AMOUNT']),
  paidFor: z.array(
    z.object({
      participantId: sourceId,
      shares: z.number().int(),
    }),
  ),
})

export const accountExportGroupPreferenceSchema = z.object({
  groupSourceId: sourceId,
  starred: z.boolean(),
  hidden: z.boolean(),
  defaultSplit: accountExportDefaultSplitSchema.nullable(),
})

const accountExportGroupIndexSchema = z.object({
  sourceId,
  displayName: z.string(),
  groupType: z.enum(['GROUP', 'FRIEND']),
  archived: z.boolean(),
  manifestPath: z.string(),
  complete: z.boolean(),
})

export const accountExportWarningSchema = exportWarningSchema.extend({
  groupSourceId: sourceId,
})

export const spliitAccountExportManifestSchema = z.object({
  format: z.literal('spliit.cloud/export'),
  version: z.literal(1),
  scope: z.object({ type: z.literal('ACCOUNT'), sourceId }),
  exportedAt: isoDateTime,
  complete: z.boolean(),
  warnings: z.array(accountExportWarningSchema),
  contents: z.object({
    documents: z.boolean(),
    accountPreferences: z.boolean(),
    groupPreferences: z.boolean(),
  }),
  account: z.object({
    sourceId,
    name: z.string(),
    email: z.string().email().nullable(),
    preferences: accountPreferenceSchema.nullable(),
    notificationPreferences: z
      .array(accountExportNotificationPreferenceSchema)
      .nullable(),
  }),
  identities: z.array(accountExportIdentitySchema),
  groups: z.array(accountExportGroupIndexSchema),
  groupPreferences: z.array(accountExportGroupPreferenceSchema).nullable(),
})

export type SpliitExportDocument = z.infer<typeof exportDocumentSchema>
export type SpliitGroupExportSnapshot = z.infer<
  typeof spliitGroupExportSnapshotSchema
>

export type SpliitGroupExportManifest = z.infer<
  typeof spliitGroupExportManifestSchema
>

export type AccountExportSelection = z.infer<
  typeof accountExportSelectionSchema
>

export type AccountExportGroupSection = z.infer<
  typeof accountExportGroupSectionSchema
>

export type SpliitAccountExportManifest = z.infer<
  typeof spliitAccountExportManifestSchema
>

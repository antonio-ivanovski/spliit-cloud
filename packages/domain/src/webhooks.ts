import * as z from 'zod'

import type { ConversionSource } from './conversion'
import type { SplitMode } from './enums'
import { calculatePaidByShare, calculateShare } from './totals'

export const WebhookApiVersion = 'v1' as const

export const webhookEventTypeSchema = z.enum([
  'expense.created',
  'expense.updated',
  'expense.deleted',
  'expenses.created',
  'expenses.updated',
  'expenses.deleted',
  'webhook.test',
])
export type WebhookEventType = z.infer<typeof webhookEventTypeSchema>

export const WebhookDeliveryStatus = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  SENT: 'SENT',
  PERMANENT_FAILURE: 'PERMANENT_FAILURE',
  RETRY_EXHAUSTED: 'RETRY_EXHAUSTED',
  CANCELED: 'CANCELED',
} as const
export type WebhookDeliveryStatus =
  (typeof WebhookDeliveryStatus)[keyof typeof WebhookDeliveryStatus]

export const webhookDeliveryStatusSchema = z.enum(
  Object.values(WebhookDeliveryStatus) as [
    WebhookDeliveryStatus,
    ...WebhookDeliveryStatus[],
  ],
)

export const webhookEventFilterSchema = z
  .object({
    created: z.boolean(),
    updated: z.boolean(),
    deleted: z.boolean(),
    involvedOnly: z.boolean(),
  })
  .refine((value) => value.created || value.updated || value.deleted, {
    message: 'eventsRequired',
  })
export type WebhookEventFilter = z.infer<typeof webhookEventFilterSchema>

export const DEFAULT_WEBHOOK_EVENT_FILTER: WebhookEventFilter = {
  created: true,
  updated: true,
  deleted: true,
  involvedOnly: false,
}

export type WebhookExpenseOperation = 'created' | 'updated' | 'deleted'

export function webhookOperationMatchesFilter(
  operation: WebhookExpenseOperation,
  filter: WebhookEventFilter,
): boolean {
  return filter[operation] === true
}

const webhookParticipantSchema = z.object({
  id: z.string(),
  name: z.string(),
  accountId: z.string().nullable(),
  removed: z.boolean(),
})

const webhookShareSchema = z.object({
  participant: webhookParticipantSchema,
  shares: z.number().int(),
})

const webhookDocumentSchema = z.object({
  id: z.string(),
  url: z.string(),
  fileName: z.string().nullable(),
  contentType: z.string().nullable(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
})

const webhookItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  unitPrice: z.number().int(),
  quantity: z.number().int(),
  amount: z.number().int(),
  splitMode: z.string(),
  notes: z.string().nullable(),
  paidFor: z.array(webhookShareSchema),
})

export const webhookExpenseSnapshotSchema = z.object({
  id: z.string(),
  version: z.number().int().positive(),
  title: z.string(),
  expenseDate: z.iso.datetime(),
  expenseTimeZone: z.string(),
  createdAt: z.iso.datetime(),
  categoryId: z.string(),
  notes: z.string().nullable(),
  amount: z.object({
    ledger: z.object({
      minor: z.number().int(),
      currency: z.string().nullable(),
    }),
    original: z
      .object({ minor: z.number().int(), currency: z.string() })
      .nullable(),
    conversionRate: z.number().nullable(),
    conversionSource: z.string().nullable(),
  }),
  splitMode: z.string(),
  paidBySplitMode: z.string(),
  paidBy: z.array(webhookShareSchema),
  paidFor: z.array(webhookShareSchema),
  items: z.array(webhookItemSchema),
  itemizedRemainder: z
    .object({
      splitMode: z.string(),
      allocationMode: z.string(),
      paidFor: z.array(webhookShareSchema),
    })
    .nullable(),
  documents: z.array(webhookDocumentSchema),
  createdBy: z.object({ id: z.string(), name: z.string() }).nullable(),
  recurrence: z
    .object({
      seriesId: z.string(),
      sequence: z.number().int().nullable(),
      frequency: z.string(),
      interval: z.number().int(),
      endType: z.string(),
      occurrenceLimit: z.number().int().nullable(),
      endDate: z.iso.datetime().nullable(),
      status: z.string(),
    })
    .nullable(),
  settlement: z.boolean(),
})
export type WebhookExpenseSnapshot = z.infer<
  typeof webhookExpenseSnapshotSchema
>

export const webhookGroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
})

export const webhookActorSchema = z.object({
  type: z.enum(['account', 'system']),
  id: z.string().nullable(),
  name: z.string().nullable(),
})

export const webhookViewerSchema = z.object({
  participantId: z.string().nullable(),
  paid: z.number().int(),
  owes: z.number().int(),
  net: z.number().int(),
  involved: z.boolean(),
})
export type WebhookViewer = z.infer<typeof webhookViewerSchema>

function snapshotToTotalsInput(snapshot: WebhookExpenseSnapshot) {
  const mapShares = (entries: WebhookExpenseSnapshot['paidFor']) =>
    entries.map((entry) => ({
      shares: entry.shares,
      participant: { id: entry.participant.id },
    }))
  return {
    id: snapshot.id,
    amount: snapshot.amount.ledger.minor,
    splitMode: snapshot.splitMode as SplitMode,
    paidBySplitMode: snapshot.paidBySplitMode as SplitMode,
    categoryId: snapshot.categoryId,
    paidByList: mapShares(snapshot.paidBy),
    paidFor: mapShares(snapshot.paidFor),
    originalAmount: snapshot.amount.original?.minor ?? null,
    originalCurrency: snapshot.amount.original?.currency ?? null,
    conversionRate: snapshot.amount.conversionRate,
    conversionSource: snapshot.amount
      .conversionSource as ConversionSource | null,
  }
}

/**
 * Derives the endpoint owner's view of one expense: what their participant
 * paid, owes, and nets (paid - owes) in ledger minor units. Pure function of
 * the snapshot — no DB access — so it can run at plan time (involved-only
 * filtering) and delivery time (per-recipient personalization of the shared
 * stored payload). `involved` means a nonzero financial stake; zero-amount
 * expenses and settlements report zeros. Unknown owners (no matching
 * participant row) get a stable null-participant shape instead of null.
 */
export function deriveViewer(
  snapshot: WebhookExpenseSnapshot,
  accountId: string | null | undefined,
): WebhookViewer {
  const participantId =
    snapshot.paidBy
      .concat(snapshot.paidFor)
      .find((entry) => entry.participant.accountId === accountId)?.participant
      .id ?? null
  if (participantId === null || accountId == null) {
    return { participantId: null, paid: 0, owes: 0, net: 0, involved: false }
  }
  const input = snapshotToTotalsInput(snapshot)
  const paid = calculatePaidByShare(participantId, input)
  const owes = calculateShare(participantId, input)
  return {
    participantId,
    paid,
    owes,
    net: paid - owes,
    involved: paid !== 0 || owes !== 0,
  }
}

const singularWebhookDataSchema = z.object({
  group: webhookGroupSchema,
  actor: webhookActorSchema,
  expense: webhookExpenseSnapshotSchema,
  viewer: webhookViewerSchema.optional(),
  changedFields: z.array(z.string()),
})

const batchWebhookDataSchema = z.object({
  group: webhookGroupSchema,
  actor: webhookActorSchema,
  batchId: z.string(),
  source: z.string(),
  expenses: z.array(
    z.object({
      expense: webhookExpenseSnapshotSchema,
      viewer: webhookViewerSchema.optional(),
      changedFields: z.array(z.string()),
    }),
  ),
})

export const webhookEnvelopeSchema = z.discriminatedUnion('type', [
  z.object({
    id: z.string(),
    apiVersion: z.literal(WebhookApiVersion),
    type: z.enum(['expense.created', 'expense.updated', 'expense.deleted']),
    occurredAt: z.iso.datetime(),
    data: singularWebhookDataSchema,
  }),
  z.object({
    id: z.string(),
    apiVersion: z.literal(WebhookApiVersion),
    type: z.enum(['expenses.created', 'expenses.updated', 'expenses.deleted']),
    occurredAt: z.iso.datetime(),
    data: batchWebhookDataSchema,
  }),
  z.object({
    id: z.string(),
    apiVersion: z.literal(WebhookApiVersion),
    type: z.literal('webhook.test'),
    occurredAt: z.iso.datetime(),
    data: z.object({ message: z.string() }),
  }),
])
export type WebhookEnvelope = z.infer<typeof webhookEnvelopeSchema>

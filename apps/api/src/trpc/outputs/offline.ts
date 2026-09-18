import { z } from 'zod'

import { listBalancesOutputSchema } from './balances'
import {
  expenseGetResponseSchema,
  expenseListItemResponseSchema,
} from './expenses'
import { globalExpenseGroupSchema } from './global-expenses'
import { getGroupOutputSchema } from './groups'
import { overviewGroupSchema } from './overview'

/**
 * Offline read contracts.
 *
 * Wire encoding: SuperJSON on the tRPC wire (existing transformer), so `Date`
 * values survive as Dates. Durable storage uses IndexedDB structured-clone
 * (Date preserved) and parse persisted payloads with these same shared Zod
 * schemas; auth cookies/tokens are never persisted.
 *
 * Namespace decision: offline storage is keyed by
 * `normalizedApiOriginAndBasePath = getApiBaseUrl()` normalized as lowercase
 * host, strip trailing slash, strip default ports (:80/:443), exclude the
 * `/trpc` suffix. API identity prevents mixing deployments served from one web
 * origin. Namespace isolation is a correctness boundary, not encryption.
 *
 * Liveness decision: recovery probes call `getApiBaseUrl()` +
 * `/health/liveness` with `cache: 'no-store'`, 5s timeout, and validate JSON `{
 * status: 'ok' }` plus a JSON content-type to reject captive-portal HTML. A
 * successful probe enables session verification, not writes.
 *
 * Snapshot cap decision: max 500 expenses per group, newest-first ordered by
 * expenseDate desc, createdAt desc, id desc. The capped response carries
 * `totalCount` (all expenses in the group), `downloadedCount` (expenses in this
 * payload), `hasMore` (totalCount > downloadedCount), and `truncatedAt`
 * (capturedAt when truncated, else null). The whole capped response succeeds or
 * fails atomically; clients preserve the existing snapshot on timeout. UI copy
 * will say the recent-500 are available offline.
 *
 * Recurrence neighbor decision: neighbor IDs are built from each series ordered
 * by `recurrenceSequence` ascending. Expenses with a null sequence are excluded
 * from the neighbor chain (their previous/next are null and they do not link
 * neighbors); this keeps the chain total-ordered without inventing an order for
 * unordered rows.
 *
 * Auth mapping (server): missing/nonmember/inactive membership -> FORBIDDEN
 * without revealing group existence; valid ACTIVE member whose group row
 * disappeared -> NOT_FOUND. Both evict the local copy after a confirmed
 * response. UNAUTHORIZED triggers session verification only.
 *
 * Transaction decision: one RepeatableRead transaction per catalog/snapshot for
 * auth + rows + calculations, 30s timeout; `capturedAt` is the transaction
 * start, not client write time.
 *
 * Browser-safety: this module imports only Zod, existing pure output schemas,
 * and browser-safe domain helpers (via those schemas). It never imports router
 * initialization, Prisma, auth, or server environment code. See
 * `offline-contract.test.ts` import-graph test.
 */

export const OFFLINE_SCHEMA_VERSION = 1 as const
export const OFFLINE_MAX_EXPENSES = 500 as const

export const offlineDocumentMetadataSchema = z.object({
  id: z.string(),
  fileName: z.string().nullable(),
  contentType: z.string().nullable(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
})

export type OfflineDocumentMetadata = z.infer<
  typeof offlineDocumentMetadataSchema
>

const offlineExpenseDetailSchema = expenseGetResponseSchema
  .omit({ documents: true })
  .extend({
    documents: z.array(offlineDocumentMetadataSchema),
  })

export const offlineExpenseRecordSchema = z.object({
  list: expenseListItemResponseSchema,
  detail: offlineExpenseDetailSchema,
})

export type OfflineExpenseRecord = z.infer<typeof offlineExpenseRecordSchema>

export const offlineCatalogEntrySchema = z.object({
  overview: overviewGroupSchema,
  global: globalExpenseGroupSchema,
})

export type OfflineCatalogEntry = z.infer<typeof offlineCatalogEntrySchema>

export const offlineCatalogOutputSchema = z.object({
  schemaVersion: z.literal(1),
  accountId: z.string().min(1),
  capturedAt: z.date(),
  groups: z.array(offlineCatalogEntrySchema),
})

export type OfflineCatalogOutput = z.infer<typeof offlineCatalogOutputSchema>

export const offlineSnapshotOutputSchema = z.object({
  schemaVersion: z.literal(1),
  accountId: z.string().min(1),
  groupId: z.string().min(1),
  capturedAt: z.date(),
  group: getGroupOutputSchema,
  overview: overviewGroupSchema,
  global: globalExpenseGroupSchema,
  balances: listBalancesOutputSchema,
  expenses: z.array(offlineExpenseRecordSchema),
  totalCount: z.number().int().nonnegative(),
  downloadedCount: z.number().int().nonnegative(),
  hasMore: z.boolean(),
  truncatedAt: z.date().nullable(),
})

export type OfflineSnapshotOutput = z.infer<typeof offlineSnapshotOutputSchema>

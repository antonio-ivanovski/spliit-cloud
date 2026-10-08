import { z } from 'zod'

import { activityListItemSchema } from './activities'
import { listBalancesOutputSchema } from './balances'
import { budgetSchema } from './budgets'
import { expenseCommentOutputSchema } from './expense-comments'
import {
  expenseGetResponseSchema,
  expenseListItemResponseSchema,
} from './expenses'
import { globalExpenseGroupSchema } from './global-expenses'
import { getGroupOutputSchema } from './groups'
import { overviewGroupSchema } from './overview'
import { splitPresetListOutputSchema } from './split-presets'
import { listSubgroupsOutputSchema } from './subgroups'

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
 * Snapshot history: all expenses are downloaded in database keyset pages within
 * one RepeatableRead transaction, with every comment attached to its expense
 * detail. Budgets (with summaries), viewer-scoped split presets, subgroup
 * definitions, and the recent activity window (OFFLINE_MAX_ACTIVITIES newest
 * first, with a has-more disclosure) join the same transaction. The client
 * promotes the complete snapshot atomically and retains its previous copy on
 * failure. Older capped snapshots remain readable until a complete replacement
 * succeeds.
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

/**
 * Offline wire/projection version (v2: comments, budgets, split presets,
 * subgroups, and recent activity join expenses/balances). This versions the
 * shape and semantics of the catalog/snapshot DTOs below. It is intentionally
 * separate from the browser IndexedDB structure version (`OFFLINE_DB_VERSION`
 * in `apps/web/src/lib/offline/contract.ts`): a projection change bumps this
 * constant (and composes into every revision token, forcing refetch), while a
 * browser-only storage restructure bumps only the DB version. Never reinterpret
 * persisted payloads across a contract bump — treat them as
 * replacement-required.
 */
export const OFFLINE_CONTRACT_VERSION = 2 as const
/**
 * Backwards-compatible alias. New code should use OFFLINE_CONTRACT_VERSION for
 * wire payloads and the web OFFLINE_DB_VERSION for storage structure.
 */
export const OFFLINE_SCHEMA_VERSION = OFFLINE_CONTRACT_VERSION
/** Database page size; retained export name for existing consumers. */
export const OFFLINE_MAX_EXPENSES = 500 as const
/**
 * Recent activity window per group snapshot. The feed beyond this window stays
 * online-only; snapshots disclose the boundary with `activityHasMore` so the
 * client never presents a partial feed as complete.
 */
export const OFFLINE_MAX_ACTIVITIES = 200 as const

/**
 * Opaque revision token binding a payload to the exact server state that
 * produced it: `o<contract>.c<contentRevision>.v<viewerRevision>`.
 *
 * - `contract` is OFFLINE_CONTRACT_VERSION: any projection change retires every
 *   token issued before it.
 * - `contentRevision` is `Group.offlineContentRevision`, advanced in-transaction
 *   by PostgreSQL triggers covering the whole snapshot dependency graph (see
 *   migration `offline_revision_tokens`).
 * - `viewerRevision` is the viewer's `AccountGroupPreference`
 *   `.offlineViewerRevision` (`0` when no preference row exists).
 *
 * Clients compare tokens for equality only — never order them — and refetch the
 * history when the published token differs from the stored one.
 */
export function buildOfflineRevisionToken(args: {
  contentRevision: bigint | number | string
  viewerRevision: bigint | number | string
  contractVersion?: number
}): string {
  const contract = args.contractVersion ?? OFFLINE_CONTRACT_VERSION
  return `o${contract}.c${String(args.contentRevision)}.v${String(args.viewerRevision)}`
}

const OFFLINE_REVISION_PATTERN = /^o(\d+)\.c(\d+)\.v(\d+)$/

export function parseOfflineRevisionToken(token: string): {
  contractVersion: number
  contentRevision: string
  viewerRevision: string
} | null {
  const match = OFFLINE_REVISION_PATTERN.exec(token)
  if (!match) return null
  return {
    contractVersion: Number(match[1]),
    contentRevision: match[2]!,
    viewerRevision: match[3]!,
  }
}

/** Equality-only comparison. Tokens from another contract never match. */
export function isSameOfflineRevision(a: string, b: string): boolean {
  if (a === b) return parseOfflineRevisionToken(a) !== null
  return false
}

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

/**
 * Expense comments use the live list shape verbatim. The snapshot viewer is
 * always an ACTIVE member, so `author`/`canDelete` follow the ACTIVE mapping of
 * the comments list procedure (no public-viewer redaction); `canDelete` remains
 * a fact captured at download time and never grants offline writes.
 */
export const offlineExpenseCommentSchema = expenseCommentOutputSchema

export type OfflineExpenseComment = z.infer<typeof offlineExpenseCommentSchema>

/**
 * Entity-table schemas for the browser Dexie store. Named exports (not inlined)
 * so the web entity layer validates rows with the exact wire shapes; any
 * projection change here must bump OFFLINE_CONTRACT_VERSION.
 */
export const offlineExpenseDetailSchema = expenseGetResponseSchema
  .omit({ documents: true })
  .extend({
    documents: z.array(offlineDocumentMetadataSchema),
    comments: z.array(offlineExpenseCommentSchema),
  })

export type OfflineExpenseDetail = z.infer<typeof offlineExpenseDetailSchema>

export const offlineExpenseListItemSchema = expenseListItemResponseSchema

export type OfflineExpenseListItem = z.infer<
  typeof offlineExpenseListItemSchema
>

export const offlineExpenseRecordSchema = z.object({
  list: expenseListItemResponseSchema,
  detail: offlineExpenseDetailSchema,
})

export type OfflineExpenseRecord = z.infer<typeof offlineExpenseRecordSchema>

export const offlineRevisionSchema = z
  .string()
  .min(1)
  .refine((value) => parseOfflineRevisionToken(value) !== null, {
    message: 'Invalid offline revision token',
  })

export const offlineCatalogEntrySchema = z.object({
  overview: overviewGroupSchema,
  global: globalExpenseGroupSchema,
  revision: offlineRevisionSchema,
})

export type OfflineCatalogEntry = z.infer<typeof offlineCatalogEntrySchema>

export const offlineCatalogOutputSchema = z.object({
  schemaVersion: z.literal(OFFLINE_CONTRACT_VERSION),
  accountId: z.string().min(1),
  capturedAt: z.date(),
  groups: z.array(offlineCatalogEntrySchema),
})

export type OfflineCatalogOutput = z.infer<typeof offlineCatalogOutputSchema>

export const offlineSnapshotOutputSchema = z.object({
  schemaVersion: z.literal(OFFLINE_CONTRACT_VERSION),
  accountId: z.string().min(1),
  groupId: z.string().min(1),
  capturedAt: z.date(),
  group: getGroupOutputSchema,
  overview: overviewGroupSchema,
  global: globalExpenseGroupSchema,
  balances: listBalancesOutputSchema,
  revision: offlineRevisionSchema,
  expenses: z.array(offlineExpenseRecordSchema),
  totalCount: z.number().int().nonnegative(),
  downloadedCount: z.number().int().nonnegative(),
  hasMore: z.boolean(),
  truncatedAt: z.date().nullable(),
  /** Budgets with server-computed summaries (history included for detail). */
  budgets: z.array(budgetSchema),
  /** Viewer-scoped split presets (shared + the viewer's personal presets). */
  splitPresets: splitPresetListOutputSchema,
  /** Subgroup definitions with the enabled flag. */
  subgroups: listSubgroupsOutputSchema,
  /**
   * Recent group-feed activities, newest first, capped at
   * OFFLINE_MAX_ACTIVITIES.
   */
  activities: z.array(activityListItemSchema),
  activityTotalCount: z.number().int().nonnegative(),
  activityHasMore: z.boolean(),
})

export type OfflineSnapshotOutput = z.infer<typeof offlineSnapshotOutputSchema>

/**
 * Group detail blob stored per group in the browser entity DB. Carries its own
 * overview/global copies so group reads stay self-sufficient when the catalog
 * lags; the catalog remains the authority for list views. Reference sections
 * (subgroups/presets/budgets/recent activity) ride in the same blob — they are
 * small and need no query indexes, unlike expense rows.
 */
export const offlineGroupDataSchema = z.object({
  group: getGroupOutputSchema,
  overview: overviewGroupSchema,
  global: globalExpenseGroupSchema,
  balances: listBalancesOutputSchema,
  subgroups: listSubgroupsOutputSchema,
  splitPresets: splitPresetListOutputSchema,
  budgets: z.array(budgetSchema),
  activities: z.array(activityListItemSchema),
  activityTotalCount: z.number().int().nonnegative(),
  activityHasMore: z.boolean(),
})

export type OfflineGroupData = z.infer<typeof offlineGroupDataSchema>

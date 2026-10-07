import { z } from 'zod'

import {
  OFFLINE_CONTRACT_VERSION,
  OFFLINE_SCHEMA_VERSION,
  buildOfflineRevisionToken,
  isSameOfflineRevision,
  offlineCatalogEntrySchema,
  offlineExpenseDetailSchema,
  offlineExpenseListItemSchema,
  offlineGroupDataSchema,
  offlineRevisionSchema,
  offlineSnapshotOutputSchema,
  parseOfflineRevisionToken,
  type OfflineCatalogEntry,
  type OfflineExpenseDetail,
  type OfflineExpenseListItem,
  type OfflineGroupData,
  type OfflineSnapshotOutput,
} from '@spliit/api/offline-contract'

import type { OfflineErrorCode } from './errors'

export {
  OFFLINE_CONTRACT_VERSION,
  OFFLINE_SCHEMA_VERSION,
  buildOfflineRevisionToken,
  isSameOfflineRevision,
  parseOfflineRevisionToken,
}
export type {
  OfflineCatalogEntry,
  OfflineExpenseDetail,
  OfflineExpenseListItem,
  OfflineGroupData,
  OfflineSnapshotOutput,
}

/**
 * Durable offline entity contract (Dexie initial release).
 *
 * The legacy whole-snapshot store (`spliit-offline`, raw `idb`) is abandoned
 * untouched: this release uses a fresh explicitly versioned Dexie database
 * below with no old-snapshot migration code and no automatic wipe. IndexedDB
 * preserves `Date` values via structured cloning. Every server payload is
 * parsed with the shared runtime schemas from `@spliit/api/offline-contract`
 * _outside_ the write transaction; the transaction only checks fencing and
 * swaps complete entity sets. Auth cookies/tokens are never serialized here.
 *
 * Tables: account controls, catalog records, lightweight group metadata, group
 * data/balances blobs, expense list rows, expense detail rows, and per-group
 * sync status. Namespace isolation (`JSON.stringify([normalizedApiOrigin,
 * accountId])`) is a correctness boundary preventing cross-deployment/account
 * mixing, not encryption: a device user can still read their own browser
 * storage.
 *
 * Versioning: `OFFLINE_DB_VERSION` is the browser storage structure version
 * (Dexie schema version). `OFFLINE_CONTRACT_VERSION` (re-exported above) is the
 * wire/projection version and composes into every server revision token, so a
 * projection change retires stored payloads even when the storage structure is
 * unchanged. Never reinterpret persisted rows across either bump.
 */

export const OFFLINE_DB_NAME = 'spliit-offline-v2'
export const OFFLINE_DB_VERSION = 1
/** After this long, `opening` stops blocking and offers a retry hook. */
export const OFFLINE_OPEN_TIMEOUT_MS = 3000
export const OFFLINE_STORAGE_BLOCKED_MESSAGE =
  'Close other Spliit tabs to finish updating offline storage.'

const nonNegativeInt = z.number().int().nonnegative()

export const controlRecordSchema = z.object({
  namespace: z.string().min(1),
  generation: nonNegativeInt,
  dataRevision: nonNegativeInt,
  revoked: z.boolean(),
  leaseOwner: z.string().nullable(),
  leaseUntil: z.number().nullable(),
})

export type ControlRecord = z.infer<typeof controlRecordSchema>

export const catalogRecordSchema = z.object({
  namespace: z.string().min(1),
  capturedAt: z.date(),
  groups: z.array(offlineCatalogEntrySchema),
  schemaVersion: z.number().int(),
})

export type CatalogRecord = z.infer<typeof catalogRecordSchema>

/**
 * Lightweight per-group metadata. Holds the publication identity
 * (`serverRevision` token + `commitNonce`), dirty state, original content
 * capture (`capturedAt`) vs last trustworthy server confirmation
 * (`lastConfirmedAt`), and snapshot completeness counters. Dirty metadata
 * updates touch only this table — never expense history.
 */
export const groupMetaRecordSchema = z.object({
  namespace: z.string().min(1),
  groupId: z.string().min(1),
  schemaVersion: z.number().int(),
  serverRevision: offlineRevisionSchema,
  capturedAt: z.date(),
  storedAt: z.date(),
  commitNonce: z.string().min(1),
  dirtySince: z.date().nullable(),
  lastConfirmedAt: z.date().nullable(),
  totalCount: nonNegativeInt,
  hasMore: z.boolean(),
  truncatedAt: z.date().nullable(),
})

export type GroupMetaRecord = z.infer<typeof groupMetaRecordSchema>

/** Group detail + balances blob for the detail view. Not indexed. */
export const groupDataRecordSchema = z.object({
  namespace: z.string().min(1),
  groupId: z.string().min(1),
  data: offlineGroupDataSchema,
})

export type GroupDataRecord = z.infer<typeof groupDataRecordSchema>

/**
 * One expense list row. Scalar query fields are duplicated at the top level as
 * millisecond timestamps / numbers so compound indexes serve sort orders
 * without deserializing blobs; complex and text filtering stays worker-side.
 */
export const expenseListRowSchema = z.object({
  namespace: z.string().min(1),
  groupId: z.string().min(1),
  id: z.string().min(1),
  expenseDateMs: z.number().int(),
  createdAtMs: z.number().int(),
  amount: z.number().int(),
  categoryId: z.string(),
  record: offlineExpenseListItemSchema,
})

export type ExpenseListRow = z.infer<typeof expenseListRowSchema>

/** One expense detail row, keyed for direct lookup. Not indexed. */
export const expenseDetailRowSchema = z.object({
  namespace: z.string().min(1),
  groupId: z.string().min(1),
  id: z.string().min(1),
  record: offlineExpenseDetailSchema,
})

export type ExpenseDetailRow = z.infer<typeof expenseDetailRowSchema>

export const groupStatusRecordSchema = z.object({
  namespace: z.string().min(1),
  groupId: z.string().min(1),
  updatedAt: z.date(),
  lastAttemptAt: z.date().nullable(),
  lastResult: z.enum(['ok', 'error']).nullable(),
  lastErrorCode: z
    .enum([
      'storage-unavailable',
      'storage-blocked',
      'quota-exceeded',
      'schema-unsupported',
      'corrupt-record',
      'generation-mismatch',
      'revision-changed',
      'namespace-revoked',
      'lease-conflict',
      'invalid-payload',
    ])
    .nullable(),
})

export type GroupStatusRecord = z.infer<typeof groupStatusRecordSchema>

/**
 * Reassembled group snapshot for read-model compatibility. Repository reads
 * compose this from the entity tables so existing local query adapters keep
 * working while Task 3 moves query ownership into the worker.
 */
export const groupRecordSchema = z.object({
  namespace: z.string().min(1),
  groupId: z.string().min(1),
  schemaVersion: z.number().int(),
  capturedAt: z.date(),
  storedAt: z.date(),
  commitNonce: z.string().min(1),
  dirtySince: z.date().nullable(),
  payload: offlineSnapshotOutputSchema,
})

export type GroupRecord = z.infer<typeof groupRecordSchema>

export type GroupAvailability = 'missing' | 'ready'

export type CatalogReadResult =
  | { status: 'missing' }
  | { status: 'ready'; record: CatalogRecord }
  | { status: 'corrupt'; reason: string }
  | { status: 'unsupported'; schemaVersion: unknown }

export type GroupReadResult =
  | { status: 'missing' }
  | { status: 'ready'; record: GroupRecord }
  | { status: 'corrupt'; reason: string }
  | { status: 'unsupported'; schemaVersion: unknown }

/**
 * Normalize `getApiBaseUrl()` for namespace identity: lowercase host, strip
 * trailing slashes and default ports (:80/:443), exclude the `/trpc` suffix.
 * Base paths other than `/trpc` are preserved; only the host is lowercased.
 */
export function normalizeApiOrigin(rawApiBaseUrl: string): string {
  let value = rawApiBaseUrl.trim().replace(/\/+$/, '')
  value = value.replace(/\/trpc\/?$/i, '').replace(/\/+$/, '')
  if (!value) return ''
  try {
    const url = new URL(value)
    const protocol = url.protocol.toLowerCase()
    const hostname = url.hostname.toLowerCase()
    let port = url.port
    if (
      (protocol === 'http:' && port === '80') ||
      (protocol === 'https:' && port === '443')
    ) {
      port = ''
    }
    const host = port ? `${hostname}:${port}` : hostname
    let pathname = url.pathname.replace(/\/+$/, '')
    pathname = pathname.replace(/\/trpc$/i, '')
    if (pathname === '/') pathname = ''
    return `${protocol}//${host}${pathname}`
  } catch {
    return value.toLowerCase().replace(/\/+$/, '')
  }
}

/** Namespace key: `JSON.stringify([normalizedApiOrigin, accountId])`. */
export function buildNamespace(apiBaseUrl: string, accountId: string): string {
  return JSON.stringify([normalizeApiOrigin(apiBaseUrl), accountId])
}

export function parseNamespace(namespace: string): {
  apiOrigin: string
  accountId: string
} | null {
  try {
    const parsed: unknown = JSON.parse(namespace)
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === 'string' &&
      typeof parsed[1] === 'string'
    ) {
      return { apiOrigin: parsed[0], accountId: parsed[1] }
    }
    return null
  } catch {
    return null
  }
}

export function isSupportedSchemaVersion(
  schemaVersion: unknown,
): schemaVersion is typeof OFFLINE_SCHEMA_VERSION {
  return schemaVersion === OFFLINE_SCHEMA_VERSION
}

/**
 * True only for integer numbers that are not the supported version. Missing or
 * malformed versions (undefined, strings, floats) are not "unsupported";
 * callers must let schema parsing classify them as corrupt/invalid-payload
 * instead of requesting an app update.
 */
export function isUnsupportedSchemaVersion(value: unknown): boolean {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    !isSupportedSchemaVersion(value)
  )
}

export function newControlRecord(namespace: string): ControlRecord {
  return {
    namespace,
    generation: 0,
    dataRevision: 0,
    revoked: false,
    leaseOwner: null,
    leaseUntil: null,
  }
}

export function newCommitNonce(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.bind(globalThis.crypto)
  if (randomUuid) return randomUuid()
  return `nonce-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

/** Group ids in a catalog entry list use the overview id as canonical. */
export function catalogGroupIds(groups: OfflineCatalogEntry[]): string[] {
  return groups.map((entry) => entry.overview.id)
}

export function getGroupAvailability(
  result: GroupReadResult,
): GroupAvailability {
  return result.status === 'ready' ? 'ready' : 'missing'
}

export type { OfflineErrorCode }

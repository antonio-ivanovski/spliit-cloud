import { z } from 'zod'

import {
  OFFLINE_SCHEMA_VERSION,
  offlineCatalogEntrySchema,
  offlineSnapshotOutputSchema,
  type OfflineCatalogEntry,
  type OfflineSnapshotOutput,
} from '@spliit/api/offline-contract'

import type { OfflineErrorCode } from './errors'

export { OFFLINE_SCHEMA_VERSION }
export type { OfflineCatalogEntry, OfflineSnapshotOutput }

/**
 * Durable offline repository contract.
 *
 * IndexedDB preserves `Date` values via structured cloning, so records store
 * `Date` objects directly. Every persisted server payload is parsed with the
 * shared runtime schemas from `@spliit/api/offline-contract`. Auth
 * cookies/tokens are never serialized here.
 *
 * Namespace isolation (`JSON.stringify([normalizedApiOrigin, accountId])`) is a
 * correctness boundary preventing cross-deployment/account mixing, not
 * encryption: a device user can still read their own browser storage.
 */

export const OFFLINE_DB_NAME = 'spliit-offline'
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
  enabled: z.boolean(),
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
      'downloads-disabled',
      'lease-conflict',
      'invalid-payload',
    ])
    .nullable(),
})

export type GroupStatusRecord = z.infer<typeof groupStatusRecordSchema>

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
    enabled: true,
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

import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { z } from 'zod'

import { getApiBaseUrl } from '@/lib/api-url'
import {
  OFFLINE_SCHEMA_VERSION,
  offlineCatalogOutputSchema,
  offlineSnapshotOutputSchema,
} from '@spliit/api/offline-contract'

import {
  OFFLINE_DB_NAME,
  OFFLINE_DB_VERSION,
  buildNamespace,
  catalogGroupIds,
  catalogRecordSchema,
  controlRecordSchema,
  groupRecordSchema,
  groupStatusRecordSchema,
  isUnsupportedSchemaVersion,
  newCommitNonce,
  newControlRecord,
  parseNamespace,
  type CatalogReadResult,
  type CatalogRecord,
  type ControlRecord,
  type GroupReadResult,
  type GroupRecord,
  type GroupStatusRecord,
} from './contract'
import {
  OfflineStorageError,
  isQuotaError,
  type OfflineErrorCode,
} from './errors'

/**
 * Durable offline read repository.
 *
 * IndexedDB (`spliit-offline`, version 1) is the durable store; TanStack Query
 * stays the network layer. Dates survive via structured cloning and every
 * persisted server payload is parsed with the shared runtime schemas. Auth
 * cookies/tokens are never written here.
 *
 * Fencing: every mutation takes a captured `generation` (and, for catalog /
 * snapshot commits, a captured `dataRevision`) and rechecks it inside the same
 * readwrite transaction. `markDirty` bumps `dataRevision` in the same
 * transaction as dirty flags/deletions so a late snapshot captured before an
 * online mutation cannot resurrect a deleted expense. `replaceCatalog` bumps
 * `generation` when it removes memberships so older downloads cannot resurrect
 * evicted groups.
 *
 * Atomicity: one group replacement is a single `put` (never delete-then-put)
 * and readiness is published only after `tx.done`. A crash before commit leaves
 * the old group untouched; a crash during the transaction yields the old or the
 * new complete group, never mixed records. There is no durable incomplete
 * staging and no maxAge/LRU/foreground expiry.
 */

interface OfflineDbSchema extends DBSchema {
  control: { key: string; value: ControlRecord }
  catalog: { key: string; value: CatalogRecord }
  groups: {
    key: [string, string]
    value: GroupRecord
    indexes: { 'by-namespace': string }
  }
  status: {
    key: [string, string]
    value: GroupStatusRecord
    indexes: { 'by-namespace': string }
  }
}

export type OfflineRepositoryOpenOptions = {
  onBlocked?: () => void
  onVersionChange?: () => void
  signal?: AbortSignal
}

export type ReplaceCatalogInput = {
  namespace: string
  generation: number
  expectedDataRevision: number
  catalog: z.infer<typeof offlineCatalogOutputSchema>
}

export type CommitGroupInput = {
  namespace: string
  generation: number
  expectedDataRevision: number
  snapshot: z.infer<typeof offlineSnapshotOutputSchema>
  leaseOwner?: string | null
}

export type MarkDirtyInput = {
  namespace: string
  generation: number
  dirtyGroupIds: string[]
  removedGroupIds?: string[]
  now?: Date
}

export type EvictGroupInput = {
  namespace: string
  generation: number
  groupId: string
}

function mapTxError(
  error: unknown,
  options?: { namespace?: string; groupId?: string },
): never {
  if (error instanceof OfflineStorageError) throw error
  if (isQuotaError(error)) {
    throw new OfflineStorageError('quota-exceeded', 'quota-exceeded', {
      ...options,
      cause: error,
    })
  }
  throw new OfflineStorageError('storage-unavailable', 'storage-unavailable', {
    ...options,
    cause: error,
  })
}

function requireControl(
  raw: unknown,
  namespace: string,
  generation: number,
): ControlRecord {
  if (!raw) {
    throw new OfflineStorageError(
      'generation-mismatch',
      'generation-mismatch',
      { namespace },
    )
  }
  const parsed = controlRecordSchema.safeParse(raw)
  if (!parsed.success) {
    throw new OfflineStorageError('corrupt-record', 'corrupt-record', {
      namespace,
    })
  }
  const control = parsed.data
  if (control.generation !== generation) {
    throw new OfflineStorageError(
      'generation-mismatch',
      'generation-mismatch',
      { namespace },
    )
  }
  return control
}

function requireNotRevoked(control: ControlRecord): void {
  if (control.revoked) {
    throw new OfflineStorageError('namespace-revoked', 'namespace-revoked', {
      namespace: control.namespace,
    })
  }
}

function groupKey(namespace: string, groupId: string): [string, string] {
  return [namespace, groupId]
}

async function collectGroupKeysForNamespace(
  tx: {
    objectStore(name: 'groups' | 'status'): {
      index(name: 'by-namespace'): {
        getAllKeys(query: string): Promise<unknown[]>
      }
    }
  },
  storeName: 'groups' | 'status',
  namespace: string,
): Promise<[string, string][]> {
  const keys = await tx
    .objectStore(storeName)
    .index('by-namespace')
    .getAllKeys(namespace)
  const out: [string, string][] = []
  for (const key of keys) {
    if (
      Array.isArray(key) &&
      key.length === 2 &&
      typeof key[0] === 'string' &&
      typeof key[1] === 'string'
    ) {
      out.push([key[0], key[1]])
    }
  }
  return out
}

export function resolveNamespace(
  accountId: string,
  apiBaseUrl?: string,
): string {
  return buildNamespace(apiBaseUrl ?? getApiBaseUrl(), accountId)
}

export class OfflineRepository {
  private readonly db: IDBPDatabase<OfflineDbSchema>

  private constructor(db: IDBPDatabase<OfflineDbSchema>) {
    this.db = db
  }

  static async open(
    options?: OfflineRepositoryOpenOptions,
  ): Promise<OfflineRepository> {
    if (options?.signal?.aborted) {
      throw new OfflineStorageError(
        'storage-unavailable',
        'storage-unavailable',
      )
    }
    const { onBlocked, onVersionChange, signal } = options ?? {}
    let db: IDBPDatabase<OfflineDbSchema>
    try {
      db = await openDB<OfflineDbSchema>(OFFLINE_DB_NAME, OFFLINE_DB_VERSION, {
        upgrade(upgraded) {
          if (!upgraded.objectStoreNames.contains('control')) {
            upgraded.createObjectStore('control', { keyPath: 'namespace' })
          }
          if (!upgraded.objectStoreNames.contains('catalog')) {
            upgraded.createObjectStore('catalog', { keyPath: 'namespace' })
          }
          if (!upgraded.objectStoreNames.contains('groups')) {
            const groups = upgraded.createObjectStore('groups', {
              keyPath: ['namespace', 'groupId'],
            })
            groups.createIndex('by-namespace', 'namespace', {
              unique: false,
            })
          }
          if (!upgraded.objectStoreNames.contains('status')) {
            const status = upgraded.createObjectStore('status', {
              keyPath: ['namespace', 'groupId'],
            })
            status.createIndex('by-namespace', 'namespace', {
              unique: false,
            })
          }
        },
        blocked() {
          onBlocked?.()
        },
        blocking() {
          // Close old connections immediately on versionchange. Never
          // auto-reload a dirty form or wipe the database as an upgrade
          // shortcut; other tabs are notified via `storage-close`.
          try {
            db.close()
          } catch {
            // Ignore close failures; the upgrade still proceeds.
          }
          onVersionChange?.()
        },
      })
    } catch (error) {
      mapTxError(error)
    }
    if (signal?.aborted) {
      try {
        db!.close()
      } catch {
        // Ignore close failures for a cancelled open.
      }
      throw new OfflineStorageError(
        'storage-unavailable',
        'storage-unavailable',
      )
    }
    return new OfflineRepository(db!)
  }

  close(): void {
    try {
      this.db.close()
    } catch {
      // Ignore close failures in tests/teardown.
    }
  }

  static async deleteDatabaseForTests(): Promise<void> {
    await deleteDB(OFFLINE_DB_NAME)
  }

  async readControl(namespace: string): Promise<ControlRecord | null> {
    const raw = await this.db.get('control', namespace)
    if (!raw) return null
    const parsed = controlRecordSchema.safeParse(raw)
    if (!parsed.success) {
      throw new OfflineStorageError('corrupt-record', 'corrupt-record', {
        namespace,
      })
    }
    return parsed.data
  }

  async ensureControl(namespace: string): Promise<ControlRecord> {
    const tx = this.db.transaction('control', 'readwrite')
    try {
      const existing = await tx.objectStore('control').get(namespace)
      if (existing) {
        const parsed = controlRecordSchema.safeParse(existing)
        if (!parsed.success) {
          throw new OfflineStorageError('corrupt-record', 'corrupt-record', {
            namespace,
          })
        }
        await tx.done
        return parsed.data
      }
      // Default enabled=true for a newly verified account/device.
      const created = newControlRecord(namespace)
      await tx.objectStore('control').put(created)
      await tx.done
      return created
    } catch (error) {
      mapTxError(error, { namespace })
    }
  }

  async readCatalog(namespace: string): Promise<CatalogReadResult> {
    const raw = await this.db.get('catalog', namespace)
    if (!raw) return { status: 'missing' }
    const rawVersion = (raw as { schemaVersion?: unknown }).schemaVersion
    if (isUnsupportedSchemaVersion(rawVersion)) {
      return { status: 'unsupported', schemaVersion: rawVersion }
    }
    const parsed = catalogRecordSchema.safeParse(raw)
    if (!parsed.success) {
      return { status: 'corrupt', reason: 'catalog-parse-failed' }
    }
    return { status: 'ready', record: parsed.data }
  }

  async readGroup(
    namespace: string,
    groupId: string,
  ): Promise<GroupReadResult> {
    const raw = await this.db.get('groups', groupKey(namespace, groupId))
    if (!raw) return { status: 'missing' }
    const rawVersion = (raw as { schemaVersion?: unknown }).schemaVersion
    if (isUnsupportedSchemaVersion(rawVersion)) {
      return { status: 'unsupported', schemaVersion: rawVersion }
    }
    const parsed = groupRecordSchema.safeParse(raw)
    if (!parsed.success) {
      return { status: 'corrupt', reason: 'group-parse-failed' }
    }
    if (parsed.data.payload.groupId !== groupId) {
      return { status: 'corrupt', reason: 'group-id-mismatch' }
    }
    return { status: 'ready', record: parsed.data }
  }

  async listGroupStatus(namespace: string): Promise<GroupStatusRecord[]> {
    const rows = await this.db.getAllFromIndex(
      'status',
      'by-namespace',
      namespace,
    )
    const out: GroupStatusRecord[] = []
    for (const row of rows) {
      const parsed = groupStatusRecordSchema.safeParse(row)
      // Skip corrupt status rows here; they carry no payload and a refresh
      // rewrites them. Never synthesize readiness from status alone.
      if (parsed.success) out.push(parsed.data)
    }
    out.sort((a, b) => a.groupId.localeCompare(b.groupId))
    return out
  }

  async replaceCatalog(
    input: ReplaceCatalogInput,
  ): Promise<{ generation: number; removedGroupIds: string[] }> {
    // Validate/prepare outside the transaction; the transaction only checks
    // fencing and swaps complete records. Check the raw version first so a
    // newer unsupported integer payload maps to schema-unsupported (never
    // overwrite) instead of a generic invalid-payload. Malformed versions
    // (missing/non-integer) fall through to schema validation below and map
    // to invalid-payload.
    const rawVersion = (input.catalog as { schemaVersion?: unknown })
      .schemaVersion
    if (isUnsupportedSchemaVersion(rawVersion)) {
      throw new OfflineStorageError(
        'schema-unsupported',
        'schema-unsupported',
        { namespace: input.namespace },
      )
    }
    const parsedCatalog = offlineCatalogOutputSchema.safeParse(input.catalog)
    if (!parsedCatalog.success) {
      throw new OfflineStorageError('invalid-payload', 'invalid-payload', {
        namespace: input.namespace,
      })
    }
    const catalog = parsedCatalog.data
    const namespaceAccount = parseNamespace(input.namespace)?.accountId
    if (namespaceAccount !== catalog.accountId) {
      throw new OfflineStorageError('invalid-payload', 'invalid-payload', {
        namespace: input.namespace,
      })
    }

    const tx = this.db.transaction(
      ['control', 'catalog', 'groups', 'status'],
      'readwrite',
    )
    try {
      const controlRaw = await tx.objectStore('control').get(input.namespace)
      const control = requireControl(
        controlRaw,
        input.namespace,
        input.generation,
      )
      requireNotRevoked(control)
      if (!control.enabled) {
        throw new OfflineStorageError(
          'downloads-disabled',
          'downloads-disabled',
          { namespace: input.namespace },
        )
      }
      if (control.dataRevision !== input.expectedDataRevision) {
        throw new OfflineStorageError('revision-changed', 'revision-changed', {
          namespace: input.namespace,
        })
      }

      const nextIds = new Set(catalogGroupIds(catalog.groups))
      const existingKeys = await collectGroupKeysForNamespace(
        tx as never,
        'groups',
        input.namespace,
      )
      const removedGroupIds = existingKeys
        .map(([, groupId]) => groupId)
        .filter((groupId) => !nextIds.has(groupId))
        .sort()

      const catalogRecord: CatalogRecord = {
        namespace: input.namespace,
        capturedAt: catalog.capturedAt,
        groups: catalog.groups,
        schemaVersion: catalog.schemaVersion,
      }
      await tx.objectStore('catalog').put(catalogRecord)
      for (const groupId of removedGroupIds) {
        await tx
          .objectStore('groups')
          .delete(groupKey(input.namespace, groupId))
        await tx
          .objectStore('status')
          .delete(groupKey(input.namespace, groupId))
      }

      let generation = control.generation
      if (removedGroupIds.length > 0) {
        // Fence older downloads so they cannot resurrect removed memberships.
        generation += 1
        await tx.objectStore('control').put({ ...control, generation })
      }
      await tx.done
      return { generation, removedGroupIds }
    } catch (error) {
      mapTxError(error, { namespace: input.namespace })
    }
  }

  async commitGroup(
    input: CommitGroupInput,
  ): Promise<{ storedAt: Date; commitNonce: string }> {
    const rawVersion = (input.snapshot as { schemaVersion?: unknown })
      .schemaVersion
    if (isUnsupportedSchemaVersion(rawVersion)) {
      // Newer unsupported integer schemas are never interpreted or
      // overwritten. Callers must request an app update instead. Malformed
      // versions fall through to snapshot validation (invalid-payload).
      throw new OfflineStorageError(
        'schema-unsupported',
        'schema-unsupported',
        {
          namespace: input.namespace,
          groupId: (input.snapshot as { groupId?: string }).groupId,
        },
      )
    }
    const parsedSnapshot = offlineSnapshotOutputSchema.safeParse(input.snapshot)
    if (!parsedSnapshot.success) {
      throw new OfflineStorageError('invalid-payload', 'invalid-payload', {
        namespace: input.namespace,
      })
    }
    const snapshot = parsedSnapshot.data
    const namespaceAccount = parseNamespace(input.namespace)?.accountId
    if (namespaceAccount !== snapshot.accountId) {
      throw new OfflineStorageError('invalid-payload', 'invalid-payload', {
        namespace: input.namespace,
        groupId: snapshot.groupId,
      })
    }

    const storedAt = new Date()
    const commitNonce = newCommitNonce()
    const tx = this.db.transaction(['control', 'groups', 'status'], 'readwrite')
    try {
      const controlRaw = await tx.objectStore('control').get(input.namespace)
      const control = requireControl(
        controlRaw,
        input.namespace,
        input.generation,
      )
      requireNotRevoked(control)
      if (!control.enabled) {
        throw new OfflineStorageError(
          'downloads-disabled',
          'downloads-disabled',
          { namespace: input.namespace, groupId: snapshot.groupId },
        )
      }
      if (control.dataRevision !== input.expectedDataRevision) {
        // A concurrent markDirty (e.g. a confirmed delete) invalidates this
        // older capture entirely; callers restart the affected work instead
        // of marking the stale response dirty.
        throw new OfflineStorageError('revision-changed', 'revision-changed', {
          namespace: input.namespace,
          groupId: snapshot.groupId,
        })
      }
      const leaseActive =
        control.leaseOwner !== null &&
        control.leaseUntil !== null &&
        control.leaseUntil > Date.now()
      if (leaseActive && input.leaseOwner !== control.leaseOwner) {
        throw new OfflineStorageError('lease-conflict', 'lease-conflict', {
          namespace: input.namespace,
          groupId: snapshot.groupId,
        })
      }

      // Single-put replacement: never delete the old snapshot before putting
      // the replacement, so a crash leaves old-or-new complete data.
      const record: GroupRecord = {
        namespace: input.namespace,
        groupId: snapshot.groupId,
        schemaVersion: snapshot.schemaVersion,
        capturedAt: snapshot.capturedAt,
        storedAt,
        commitNonce,
        dirtySince: null,
        payload: snapshot,
      }
      await tx.objectStore('groups').put(record)
      const status: GroupStatusRecord = {
        namespace: input.namespace,
        groupId: snapshot.groupId,
        updatedAt: storedAt,
        lastAttemptAt: storedAt,
        lastResult: 'ok',
        lastErrorCode: null,
      }
      await tx.objectStore('status').put(status)
      // Publish readiness only after the transaction commits.
      await tx.done
      return { storedAt, commitNonce }
    } catch (error) {
      mapTxError(error, {
        namespace: input.namespace,
        groupId: snapshot.groupId,
      })
    }
  }

  async markDirty(input: MarkDirtyInput): Promise<{ dataRevision: number }> {
    const now = input.now ?? new Date()
    const tx = this.db.transaction(['control', 'groups', 'status'], 'readwrite')
    try {
      const controlRaw = await tx.objectStore('control').get(input.namespace)
      const control = requireControl(
        controlRaw,
        input.namespace,
        input.generation,
      )
      requireNotRevoked(control)

      const dataRevision = control.dataRevision + 1
      await tx.objectStore('control').put({ ...control, dataRevision })

      for (const groupId of input.dirtyGroupIds) {
        const existing = (await tx
          .objectStore('groups')
          .get(groupKey(input.namespace, groupId))) as GroupRecord | undefined
        if (!existing) continue
        await tx.objectStore('groups').put({ ...existing, dirtySince: now })
      }
      for (const groupId of input.removedGroupIds ?? []) {
        await tx
          .objectStore('groups')
          .delete(groupKey(input.namespace, groupId))
        await tx
          .objectStore('status')
          .delete(groupKey(input.namespace, groupId))
      }
      await tx.done
      return { dataRevision }
    } catch (error) {
      mapTxError(error, { namespace: input.namespace })
    }
  }

  async evictGroup(input: EvictGroupInput): Promise<{ dataRevision: number }> {
    const tx = this.db.transaction(['control', 'groups', 'status'], 'readwrite')
    try {
      const controlRaw = await tx.objectStore('control').get(input.namespace)
      const control = requireControl(
        controlRaw,
        input.namespace,
        input.generation,
      )
      // Eviction is cleanup: allow it for revoked/disabled namespaces, but
      // still bump dataRevision in the same transaction so a late snapshot
      // captured before eviction cannot resurrect the group.
      const dataRevision = control.dataRevision + 1
      await tx.objectStore('control').put({ ...control, dataRevision })
      await tx
        .objectStore('groups')
        .delete(groupKey(input.namespace, input.groupId))
      await tx
        .objectStore('status')
        .delete(groupKey(input.namespace, input.groupId))
      await tx.done
      return { dataRevision }
    } catch (error) {
      mapTxError(error, {
        namespace: input.namespace,
        groupId: input.groupId,
      })
    }
  }

  /**
   * IDB-backed per-namespace download lease.
   *
   * One tab owns downloads at a time: random `owner`, 30s expiry, renewed every
   * 10s during work. Acquire/renew compare owner + generation inside the same
   * control transaction; loser tabs read committed results instead of
   * downloading. A crashed owner becomes replaceable after expiry. Generation
   * fencing is still required on every commit (see `commitGroup`).
   */
  async acquireLease(options: {
    namespace: string
    generation: number
    owner: string
    ttlMs?: number
    now?: number
  }): Promise<{ leaseOwner: string; leaseUntil: number }> {
    const now = options.now ?? Date.now()
    const ttlMs = options.ttlMs ?? 30_000
    const tx = this.db.transaction('control', 'readwrite')
    try {
      const controlRaw = await tx.objectStore('control').get(options.namespace)
      const control = requireControl(
        controlRaw,
        options.namespace,
        options.generation,
      )
      requireNotRevoked(control)
      if (!control.enabled) {
        throw new OfflineStorageError(
          'downloads-disabled',
          'downloads-disabled',
          { namespace: options.namespace },
        )
      }
      const active =
        control.leaseOwner !== null &&
        control.leaseUntil !== null &&
        control.leaseUntil > now
      if (active && control.leaseOwner !== options.owner) {
        throw new OfflineStorageError('lease-conflict', 'lease-conflict', {
          namespace: options.namespace,
        })
      }
      const leaseUntil = now + ttlMs
      await tx.objectStore('control').put({
        ...control,
        leaseOwner: options.owner,
        leaseUntil,
      })
      await tx.done
      return { leaseOwner: options.owner, leaseUntil }
    } catch (error) {
      mapTxError(error, { namespace: options.namespace })
    }
  }

  async renewLease(options: {
    namespace: string
    generation: number
    owner: string
    ttlMs?: number
    now?: number
  }): Promise<{ leaseOwner: string; leaseUntil: number }> {
    const now = options.now ?? Date.now()
    const ttlMs = options.ttlMs ?? 30_000
    const tx = this.db.transaction('control', 'readwrite')
    try {
      const controlRaw = await tx.objectStore('control').get(options.namespace)
      const control = requireControl(
        controlRaw,
        options.namespace,
        options.generation,
      )
      requireNotRevoked(control)
      if (control.leaseOwner !== options.owner) {
        // Stolen after expiry or fenced by disable/clear: the old owner must
        // cancel and never commit again with this owner.
        throw new OfflineStorageError('lease-conflict', 'lease-conflict', {
          namespace: options.namespace,
        })
      }
      const leaseUntil = now + ttlMs
      await tx.objectStore('control').put({ ...control, leaseUntil })
      await tx.done
      return { leaseOwner: options.owner, leaseUntil }
    } catch (error) {
      mapTxError(error, { namespace: options.namespace })
    }
  }

  async releaseLease(options: {
    namespace: string
    generation: number
    owner: string
  }): Promise<void> {
    const tx = this.db.transaction('control', 'readwrite')
    try {
      const controlRaw = await tx.objectStore('control').get(options.namespace)
      const control = requireControl(
        controlRaw,
        options.namespace,
        options.generation,
      )
      // Only the owner clears; never clear another tab's fresh lease.
      if (control.leaseOwner !== options.owner) {
        await tx.done
        return
      }
      await tx.objectStore('control').put({
        ...control,
        leaseOwner: null,
        leaseUntil: null,
      })
      await tx.done
    } catch (error) {
      mapTxError(error, { namespace: options.namespace })
    }
  }

  /**
   * Atomic local expense deletion after a successful online delete.
   *
   * Removes the expense from list/detail in the same transaction that bumps
   * `dataRevision` and sets `dirtySince`, so a late snapshot captured before
   * the delete cannot resurrect it (its commit fails `revision-changed`).
   * Balances/overview stay as stored server facts with `dirtySince` marking
   * them stale; totals are never hand-recalculated here.
   */
  async deleteExpenseLocally(options: {
    namespace: string
    generation: number
    groupId: string
    expenseId: string
    now?: Date
  }): Promise<{ dataRevision: number }> {
    const now = options.now ?? new Date()
    const tx = this.db.transaction(['control', 'groups'], 'readwrite')
    try {
      const controlRaw = await tx.objectStore('control').get(options.namespace)
      const control = requireControl(
        controlRaw,
        options.namespace,
        options.generation,
      )
      // Cleanup path: allowed for revoked/disabled namespaces, but still
      // bumps dataRevision so late snapshots cannot resurrect the row.
      const dataRevision = control.dataRevision + 1
      await tx.objectStore('control').put({ ...control, dataRevision })
      const existing = (await tx
        .objectStore('groups')
        .get(groupKey(options.namespace, options.groupId))) as
        | GroupRecord
        | undefined
      if (existing) {
        const filtered = existing.payload.expenses.filter(
          (record) =>
            record.list.id !== options.expenseId &&
            record.detail.id !== options.expenseId,
        )
        if (filtered.length !== existing.payload.expenses.length) {
          const removed = existing.payload.expenses.length - filtered.length
          await tx.objectStore('groups').put({
            ...existing,
            commitNonce: newCommitNonce(),
            dirtySince: now,
            payload: {
              ...existing.payload,
              expenses: filtered,
              downloadedCount: filtered.length,
              totalCount: Math.max(0, existing.payload.totalCount - removed),
            },
          })
        } else {
          // Expense already absent: still mark stale so balances/overview
          // warn until a coherent refresh commits.
          await tx.objectStore('groups').put({ ...existing, dirtySince: now })
        }
      }
      await tx.done
      return { dataRevision }
    } catch (error) {
      mapTxError(error, {
        namespace: options.namespace,
        groupId: options.groupId,
      })
    }
  }

  /**
   * Immediate local group eviction after a successful online delete/leave.
   * Deletes the group + status and removes its catalog entry in one transaction
   * while bumping `dataRevision` so older downloads cannot resurrect it. Never
   * touches SW caches, appearance, or server data.
   */
  async deleteGroupLocally(options: {
    namespace: string
    generation: number
    groupId: string
  }): Promise<{ dataRevision: number }> {
    const tx = this.db.transaction(
      ['control', 'catalog', 'groups', 'status'],
      'readwrite',
    )
    try {
      const controlRaw = await tx.objectStore('control').get(options.namespace)
      const control = requireControl(
        controlRaw,
        options.namespace,
        options.generation,
      )
      const dataRevision = control.dataRevision + 1
      await tx.objectStore('control').put({ ...control, dataRevision })
      await tx
        .objectStore('groups')
        .delete(groupKey(options.namespace, options.groupId))
      await tx
        .objectStore('status')
        .delete(groupKey(options.namespace, options.groupId))
      const catalogRaw = await tx.objectStore('catalog').get(options.namespace)
      if (catalogRaw) {
        const parsed = catalogRecordSchema.safeParse(catalogRaw)
        if (parsed.success) {
          const remaining = parsed.data.groups.filter(
            (entry) => entry.overview.id !== options.groupId,
          )
          if (remaining.length !== parsed.data.groups.length) {
            await tx.objectStore('catalog').put({
              ...parsed.data,
              groups: remaining,
            })
          }
        }
      }
      await tx.done
      return { dataRevision }
    } catch (error) {
      mapTxError(error, {
        namespace: options.namespace,
        groupId: options.groupId,
      })
    }
  }

  async setEnabled(options: {
    namespace: string
    generation: number
    enabled: boolean
  }): Promise<{ generation: number }> {
    const tx = this.db.transaction('control', 'readwrite')
    try {
      const controlRaw = await tx.objectStore('control').get(options.namespace)
      const control = requireControl(
        controlRaw,
        options.namespace,
        options.generation,
      )
      requireNotRevoked(control)
      if (control.enabled === options.enabled) {
        // Even when already disabled, drop any stale lease in the same
        // transaction so a later re-enable starts without an old owner
        // blocking new commits (mirror clearDownloads).
        if (
          !options.enabled &&
          (control.leaseOwner !== null || control.leaseUntil !== null)
        ) {
          await tx
            .objectStore('control')
            .put({ ...control, leaseOwner: null, leaseUntil: null })
        }
        await tx.done
        return { generation: control.generation }
      }
      // Disabling cancels the pass: fence in-flight commits, retain completed
      // snapshots, clear the download lease, and prevent new commits until
      // re-enabled.
      const generation =
        !options.enabled && control.enabled
          ? control.generation + 1
          : control.generation
      await tx.objectStore('control').put({
        ...control,
        enabled: options.enabled,
        generation,
        // Clear the lease when disabling so disable->enable->commit with a
        // new owner succeeds (mirror clearDownloads, same-tx).
        ...(!options.enabled ? { leaseOwner: null, leaseUntil: null } : {}),
      })
      await tx.done
      return { generation }
    } catch (error) {
      mapTxError(error, { namespace: options.namespace })
    }
  }

  async clearDownloads(options: {
    namespace: string
    generation: number
  }): Promise<{ generation: number }> {
    const tx = this.db.transaction(
      ['control', 'catalog', 'groups', 'status'],
      'readwrite',
    )
    try {
      const controlRaw = await tx.objectStore('control').get(options.namespace)
      const control = requireControl(
        controlRaw,
        options.namespace,
        options.generation,
      )
      const generation = control.generation + 1
      await tx.objectStore('control').put({
        ...control,
        generation,
        enabled: false,
        leaseOwner: null,
        leaseUntil: null,
      })
      await tx.objectStore('catalog').delete(options.namespace)
      const groupKeys = await collectGroupKeysForNamespace(
        tx as never,
        'groups',
        options.namespace,
      )
      for (const key of groupKeys) {
        await tx.objectStore('groups').delete(key)
      }
      const statusKeys = await collectGroupKeysForNamespace(
        tx as never,
        'status',
        options.namespace,
      )
      for (const key of statusKeys) {
        await tx.objectStore('status').delete(key)
      }
      await tx.done
      return { generation }
    } catch (error) {
      mapTxError(error, { namespace: options.namespace })
    }
  }

  async revokeNamespace(options: {
    namespace: string
    generation: number
  }): Promise<{ generation: number }> {
    const tx = this.db.transaction(
      ['control', 'catalog', 'groups', 'status'],
      'readwrite',
    )
    try {
      const existingRaw = await tx.objectStore('control').get(options.namespace)
      if (!existingRaw) {
        if (options.generation !== 0) {
          throw new OfflineStorageError(
            'generation-mismatch',
            'generation-mismatch',
            { namespace: options.namespace },
          )
        }
        const created = newControlRecord(options.namespace)
        const generation = 1
        await tx.objectStore('control').put({
          ...created,
          generation,
          enabled: false,
          revoked: true,
        })
        await tx.done
        return { generation }
      }
      const parsedExisting = controlRecordSchema.safeParse(existingRaw)
      if (!parsedExisting.success) {
        throw new OfflineStorageError('corrupt-record', 'corrupt-record', {
          namespace: options.namespace,
        })
      }
      const existing = parsedExisting.data
      if (existing.generation !== options.generation) {
        throw new OfflineStorageError(
          'generation-mismatch',
          'generation-mismatch',
          { namespace: options.namespace },
        )
      }
      const generation = existing.generation + 1
      await tx.objectStore('control').put({
        ...existing,
        generation,
        revoked: true,
        leaseOwner: null,
        leaseUntil: null,
      })
      await tx.objectStore('catalog').delete(options.namespace)
      const groupKeys = await collectGroupKeysForNamespace(
        tx as never,
        'groups',
        options.namespace,
      )
      for (const key of groupKeys) {
        await tx.objectStore('groups').delete(key)
      }
      const statusKeys = await collectGroupKeysForNamespace(
        tx as never,
        'status',
        options.namespace,
      )
      for (const key of statusKeys) {
        await tx.objectStore('status').delete(key)
      }
      await tx.done
      return { generation }
    } catch (error) {
      mapTxError(error, { namespace: options.namespace })
    }
  }

  async recordAttempt(options: {
    namespace: string
    generation: number
    groupId: string
    result: 'ok' | 'error'
    errorCode?: OfflineErrorCode | null
    now?: Date
  }): Promise<void> {
    const now = options.now ?? new Date()
    const tx = this.db.transaction(['control', 'status'], 'readwrite')
    try {
      const controlRaw = await tx.objectStore('control').get(options.namespace)
      const control = requireControl(
        controlRaw,
        options.namespace,
        options.generation,
      )
      requireNotRevoked(control)
      const status: GroupStatusRecord = {
        namespace: options.namespace,
        groupId: options.groupId,
        updatedAt: now,
        lastAttemptAt: now,
        lastResult: options.result,
        lastErrorCode:
          options.result === 'error'
            ? (options.errorCode ?? 'storage-unavailable')
            : null,
      }
      await tx.objectStore('status').put(status)
      await tx.done
    } catch (error) {
      mapTxError(error, {
        namespace: options.namespace,
        groupId: options.groupId,
      })
    }
  }

  /**
   * Reactivate a previously revoked namespace after a fresh uncached server
   * session for the same account.
   *
   * Finishes deletion of old revoked payloads, increments generation, resets
   * dataRevision/lease for the new empty lifecycle, preserves the device's
   * enabled/disabled preference, and clears the revoked flag. Callers clear the
   * localStorage revocation marker only after this resolves.
   */
  async reactivateNamespace(options: {
    namespace: string
  }): Promise<{ generation: number; enabled: boolean }> {
    const tx = this.db.transaction(
      ['control', 'catalog', 'groups', 'status'],
      'readwrite',
    )
    try {
      const existingRaw = await tx.objectStore('control').get(options.namespace)
      if (!existingRaw) {
        const created = newControlRecord(options.namespace)
        const generation = 1
        await tx.objectStore('control').put({
          ...created,
          generation,
          dataRevision: 0,
          leaseOwner: null,
          leaseUntil: null,
          revoked: false,
        })
        await tx.done
        return { generation, enabled: created.enabled }
      }
      const parsed = controlRecordSchema.safeParse(existingRaw)
      if (!parsed.success) {
        throw new OfflineStorageError('corrupt-record', 'corrupt-record', {
          namespace: options.namespace,
        })
      }
      const existing = parsed.data
      if (!existing.revoked) {
        await tx.done
        return { generation: existing.generation, enabled: existing.enabled }
      }
      const generation = existing.generation + 1
      const enabled = existing.enabled
      await tx.objectStore('control').put({
        ...existing,
        generation,
        dataRevision: 0,
        leaseOwner: null,
        leaseUntil: null,
        revoked: false,
        enabled,
      })
      await tx.objectStore('catalog').delete(options.namespace)
      const groupKeys = await collectGroupKeysForNamespace(
        tx as never,
        'groups',
        options.namespace,
      )
      for (const key of groupKeys) {
        await tx.objectStore('groups').delete(key)
      }
      const statusKeys = await collectGroupKeysForNamespace(
        tx as never,
        'status',
        options.namespace,
      )
      for (const key of statusKeys) {
        await tx.objectStore('status').delete(key)
      }
      await tx.done
      return { generation, enabled }
    } catch (error) {
      mapTxError(error, { namespace: options.namespace })
    }
  }
}

export type { OfflineErrorCode }

/**
 * Informational capacity probe for settings UI. Never a capacity guarantee and
 * never a reason to auto-evict; quota failures are handled per transaction
 * above.
 */
export async function estimateStorage(): Promise<{
  quota?: number
  usage?: number
} | null> {
  try {
    const storage = globalThis.navigator?.storage
    if (!storage?.estimate) return null
    const estimate = await storage.estimate()
    return { quota: estimate.quota, usage: estimate.usage }
  } catch {
    return null
  }
}

export { OFFLINE_SCHEMA_VERSION }

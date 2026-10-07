import type { z } from 'zod'

import { getApiBaseUrl } from '@/lib/api-url'
import {
  OFFLINE_CONTRACT_VERSION,
  offlineCatalogOutputSchema,
  offlineSnapshotOutputSchema,
} from '@spliit/api/offline-contract'

import {
  buildNamespace,
  catalogGroupIds,
  catalogRecordSchema,
  controlRecordSchema,
  OFFLINE_DB_VERSION,
  groupDataRecordSchema,
  groupMetaRecordSchema,
  groupRecordSchema,
  groupStatusRecordSchema,
  isUnsupportedSchemaVersion,
  newCommitNonce,
  newControlRecord,
  parseNamespace,
  type CatalogReadResult,
  type CatalogRecord,
  type ControlRecord,
  type ExpenseDetailRow,
  type ExpenseListRow,
  type GroupDataRecord,
  type GroupMetaRecord,
  type GroupReadResult,
  type GroupRecord,
  type GroupStatusRecord,
} from './contract'
import {
  listGroupIdsForNamespace,
  mapDexieError,
  openOfflineDatabase,
  deleteOfflineDatabaseForTests,
  type OfflineDexieDatabase,
} from './database'
import { OfflineStorageError, type OfflineErrorCode } from './errors'

/**
 * Durable offline read repository over the Dexie entity store.
 *
 * Dexie is the sole direct IndexedDB wrapper; TanStack Query stays the network
 * layer. Dates survive via structured cloning and every persisted server
 * payload is parsed with the shared runtime schemas _outside_ the write
 * transaction. Auth cookies/tokens are never written here.
 *
 * Fencing: every mutation takes a captured `generation` (and, for catalog /
 * snapshot commits, a captured `dataRevision`) and rechecks it inside the same
 * readwrite transaction. `markDirty` bumps `dataRevision` in the same
 * transaction as dirty flags/deletions so a late snapshot captured before an
 * online mutation cannot resurrect a deleted expense. `replaceCatalog` bumps
 * `generation` when it removes memberships so older downloads cannot resurrect
 * evicted groups.
 *
 * Atomicity: one group replacement is a single Dexie transaction across the
 * metadata, data, and expense tables (never delete-then-put across separate
 * transactions). A crash leaves old-or-new complete data, never mixed rows.
 * Failed writes retain the previous complete group; quota failures stop writes
 * while preserving reads, with no eviction or retry loop. Dirty metadata
 * updates touch only the metadata table and never rewrite history. Commit
 * notification (the returned receipt) is produced only after the transaction
 * commits.
 */

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
  leaseOwner?: string | null
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

function requireMetaVersion(meta: GroupMetaRecord, namespace: string): void {
  if (
    typeof meta.schemaVersion === 'number' &&
    Number.isInteger(meta.schemaVersion) &&
    meta.schemaVersion !== OFFLINE_DB_VERSION
  ) {
    throw new OfflineStorageError('schema-unsupported', 'schema-unsupported', {
      namespace,
      groupId: meta.groupId,
    })
  }
}

export function resolveNamespace(
  accountId: string,
  apiBaseUrl?: string,
): string {
  return buildNamespace(apiBaseUrl ?? getApiBaseUrl(), accountId)
}

function toListRow(
  namespace: string,
  groupId: string,
  entry: {
    list: {
      id: string
      expenseDate: Date
      createdAt: Date
      amount: number
      categoryId: string
    }
  } & Record<string, unknown>,
): ExpenseListRow {
  const expenseDateMs = new Date(entry.list.expenseDate).getTime()
  const createdAtMs = new Date(entry.list.createdAt).getTime()
  if (!Number.isInteger(expenseDateMs) || !Number.isInteger(createdAtMs)) {
    throw new OfflineStorageError('invalid-payload', 'invalid-payload', {
      namespace,
      groupId,
    })
  }
  return {
    namespace,
    groupId,
    id: entry.list.id,
    expenseDateMs,
    createdAtMs,
    amount: entry.list.amount,
    categoryId: entry.list.categoryId,
    record: entry.list as ExpenseListRow['record'],
  }
}

export class OfflineRepository {
  private readonly db: OfflineDexieDatabase

  private constructor(db: OfflineDexieDatabase) {
    this.db = db
  }

  static async open(
    options?: OfflineRepositoryOpenOptions,
  ): Promise<OfflineRepository> {
    try {
      const db = await openOfflineDatabase({
        onBlocked: options?.onBlocked,
        onVersionChange: options?.onVersionChange,
        signal: options?.signal,
      })
      return new OfflineRepository(db)
    } catch (error) {
      mapDexieError(error)
    }
  }

  close(): void {
    try {
      this.db.close()
    } catch {
      // Ignore close failures in tests/teardown.
    }
  }

  static async deleteDatabaseForTests(): Promise<void> {
    await deleteOfflineDatabaseForTests()
  }

  /** Exposed for the query worker: Dexie-backed local reads without copies. */
  get database(): OfflineDexieDatabase {
    return this.db
  }

  async readControl(namespace: string): Promise<ControlRecord | null> {
    try {
      const raw = await this.db.controls.get(namespace)
      if (!raw) return null
      const parsed = controlRecordSchema.safeParse(raw)
      if (!parsed.success) {
        throw new OfflineStorageError('corrupt-record', 'corrupt-record', {
          namespace,
        })
      }
      return parsed.data
    } catch (error) {
      mapDexieError(error, { namespace })
    }
  }

  async ensureControl(namespace: string): Promise<ControlRecord> {
    try {
      return await this.db.transaction('rw', this.db.controls, async () => {
        const existing = await this.db.controls.get(namespace)
        if (existing) {
          const parsed = controlRecordSchema.safeParse(existing)
          if (!parsed.success) {
            throw new OfflineStorageError('corrupt-record', 'corrupt-record', {
              namespace,
            })
          }
          return parsed.data
        }
        const created = newControlRecord(namespace)
        await this.db.controls.put(created)
        return created
      })
    } catch (error) {
      mapDexieError(error, { namespace })
    }
  }

  async readCatalog(namespace: string): Promise<CatalogReadResult> {
    try {
      const raw = await this.db.catalogs.get(namespace)
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
    } catch (error) {
      mapDexieError(error, { namespace })
    }
  }

  /**
   * Reassemble a group snapshot from the entity tables. List rows are ordered
   * expenseDate desc, createdAt desc, id desc to match server pagination; a
   * missing detail twin or catalog entry is corruption, never a silent partial
   * payload.
   */
  async readGroup(
    namespace: string,
    groupId: string,
  ): Promise<GroupReadResult> {
    try {
      // Single readonly transaction so a concurrent commit cannot mix old
      // meta (revision/capturedAt) with new expense rows. Parsing stays
      // outside the transaction; only the four raw reads are fenced.
      const [metaRaw, dataRaw, listRows, detailRows] =
        await this.db.transaction(
          'r',
          [
            this.db.groupMeta,
            this.db.groupData,
            this.db.expenseList,
            this.db.expenseDetail,
          ],
          async () =>
            Promise.all([
              this.db.groupMeta.get([namespace, groupId]),
              this.db.groupData.get([namespace, groupId]),
              this.db.expenseList
                .where('[namespace+groupId]')
                .equals([namespace, groupId])
                .toArray(),
              this.db.expenseDetail
                .where('[namespace+groupId]')
                .equals([namespace, groupId])
                .toArray(),
            ]),
        )
      if (!metaRaw) return { status: 'missing' }
      const metaParsed = groupMetaRecordSchema.safeParse(metaRaw)
      if (!metaParsed.success) {
        return { status: 'corrupt', reason: 'meta-parse-failed' }
      }
      const meta = metaParsed.data
      try {
        requireMetaVersion(meta, namespace)
      } catch (error) {
        if (
          error instanceof OfflineStorageError &&
          error.code === 'schema-unsupported'
        ) {
          return { status: 'unsupported', schemaVersion: meta.schemaVersion }
        }
        throw error
      }
      // Group reads are self-sufficient: the data blob carries its own
      // overview/global copies, so a corrupt catalog never takes validated
      // group detail offline. The catalog stays the authority for lists.
      const dataParsed = groupDataRecordSchema.safeParse(dataRaw)
      if (!dataParsed.success) {
        return { status: 'corrupt', reason: 'group-data-missing' }
      }
      const detailById = new Map(detailRows.map((row) => [row.id, row.record]))
      // Server pagination order: expenseDate desc, createdAt desc, id desc.
      const ordered = [...listRows].sort((a, b) => {
        if (a.expenseDateMs !== b.expenseDateMs) {
          return b.expenseDateMs - a.expenseDateMs
        }
        if (a.createdAtMs !== b.createdAtMs) {
          return b.createdAtMs - a.createdAtMs
        }
        return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
      })
      const expenses: GroupRecord['payload']['expenses'] = []
      for (const row of ordered) {
        const detail = detailById.get(row.id)
        if (!detail || row.id !== row.record.id) {
          return { status: 'corrupt', reason: 'expense-twin-missing' }
        }
        expenses.push({ list: row.record, detail })
      }
      const accountId = parseNamespace(namespace)?.accountId
      if (!accountId) {
        return { status: 'corrupt', reason: 'namespace-mismatch' }
      }
      const payload = {
        schemaVersion: OFFLINE_CONTRACT_VERSION,
        accountId,
        groupId,
        capturedAt: meta.capturedAt,
        group: dataParsed.data.data.group,
        overview: dataParsed.data.data.overview,
        global: dataParsed.data.data.global,
        balances: dataParsed.data.data.balances,
        revision: meta.serverRevision,
        expenses,
        totalCount: meta.totalCount,
        downloadedCount: ordered.length,
        hasMore: meta.hasMore,
        truncatedAt: meta.truncatedAt,
        subgroups: dataParsed.data.data.subgroups,
        splitPresets: dataParsed.data.data.splitPresets,
        budgets: dataParsed.data.data.budgets,
        activities: dataParsed.data.data.activities,
        activityTotalCount: dataParsed.data.data.activityTotalCount,
        activityHasMore: dataParsed.data.data.activityHasMore,
      }
      const parsed = groupRecordSchema.safeParse({
        namespace,
        groupId,
        schemaVersion: OFFLINE_DB_VERSION,
        capturedAt: meta.capturedAt,
        storedAt: meta.storedAt,
        commitNonce: meta.commitNonce,
        dirtySince: meta.dirtySince,
        payload,
      })
      if (!parsed.success) {
        return { status: 'corrupt', reason: 'group-parse-failed' }
      }
      return { status: 'ready', record: parsed.data }
    } catch (error) {
      mapDexieError(error, { namespace, groupId })
    }
  }

  async readGroupMeta(
    namespace: string,
    groupId: string,
  ): Promise<
    | { status: 'missing' }
    | { status: 'ready'; record: GroupMetaRecord }
    | { status: 'corrupt'; reason: string }
    | { status: 'unsupported'; schemaVersion: unknown }
  > {
    try {
      const metaRaw = await this.db.groupMeta.get([namespace, groupId])
      if (!metaRaw) return { status: 'missing' }
      const parsed = groupMetaRecordSchema.safeParse(metaRaw)
      if (!parsed.success) {
        return { status: 'corrupt', reason: 'meta-parse-failed' }
      }
      try {
        requireMetaVersion(parsed.data, namespace)
      } catch (error) {
        if (
          error instanceof OfflineStorageError &&
          error.code === 'schema-unsupported'
        ) {
          return {
            status: 'unsupported',
            schemaVersion: parsed.data.schemaVersion,
          }
        }
        throw error
      }
      return { status: 'ready', record: parsed.data }
    } catch (error) {
      mapDexieError(error, { namespace, groupId })
    }
  }

  async readGroupData(
    namespace: string,
    groupId: string,
  ): Promise<
    | { status: 'missing' }
    | { status: 'ready'; record: GroupDataRecord }
    | { status: 'corrupt'; reason: string }
  > {
    try {
      const dataRaw = await this.db.groupData.get([namespace, groupId])
      if (!dataRaw) return { status: 'missing' }
      const parsed = groupDataRecordSchema.safeParse(dataRaw)
      if (!parsed.success) {
        return { status: 'corrupt', reason: 'group-data-missing' }
      }
      return { status: 'ready', record: parsed.data }
    } catch (error) {
      mapDexieError(error, { namespace, groupId })
    }
  }

  async listGroupStatus(namespace: string): Promise<GroupStatusRecord[]> {
    try {
      const rows = await this.db.statuses
        .where('namespace')
        .equals(namespace)
        .toArray()
      const out: GroupStatusRecord[] = []
      for (const row of rows) {
        const parsed = groupStatusRecordSchema.safeParse(row)
        // Skip corrupt status rows here; they carry no payload and a refresh
        // rewrites them. Never synthesize readiness from status alone.
        if (parsed.success) out.push(parsed.data)
      }
      out.sort((a, b) => a.groupId.localeCompare(b.groupId))
      return out
    } catch (error) {
      mapDexieError(error, { namespace })
    }
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

    try {
      return await this.db.transaction(
        'rw',
        [
          this.db.controls,
          this.db.catalogs,
          this.db.groupMeta,
          this.db.groupData,
          this.db.expenseList,
          this.db.expenseDetail,
          this.db.statuses,
        ],
        async () => {
          const controlRaw = await this.db.controls.get(input.namespace)
          const control = requireControl(
            controlRaw,
            input.namespace,
            input.generation,
          )
          requireNotRevoked(control)
          if (control.dataRevision !== input.expectedDataRevision) {
            throw new OfflineStorageError(
              'revision-changed',
              'revision-changed',
              { namespace: input.namespace },
            )
          }

          if (
            control.leaseOwner !== null &&
            control.leaseUntil !== null &&
            control.leaseUntil > Date.now() &&
            input.leaseOwner !== control.leaseOwner
          ) {
            throw new OfflineStorageError('lease-conflict', 'lease-conflict', {
              namespace: input.namespace,
            })
          }

          const nextIds = new Set(catalogGroupIds(catalog.groups))
          const existingIds = await listGroupIdsForNamespace(
            this.db,
            input.namespace,
          )
          const removedGroupIds = existingIds
            .filter((groupId) => !nextIds.has(groupId))
            .sort()

          const catalogRecord: CatalogRecord = {
            namespace: input.namespace,
            capturedAt: catalog.capturedAt,
            groups: catalog.groups,
            schemaVersion: catalog.schemaVersion,
          }
          await this.db.catalogs.put(catalogRecord)
          for (const groupId of removedGroupIds) {
            await this.deleteGroupRows(input.namespace, groupId)
          }

          let generation = control.generation
          if (removedGroupIds.length > 0) {
            // Fence older downloads so they cannot resurrect removed memberships.
            generation += 1
            await this.db.controls.put({ ...control, generation })
          }
          return { generation, removedGroupIds }
        },
      )
    } catch (error) {
      mapDexieError(error, { namespace: input.namespace })
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

    // Decompose outside the transaction: indexed scalars are derived here so
    // the transaction only checks fencing and swaps complete entity sets.
    const listRows: ExpenseListRow[] = snapshot.expenses.map((entry) =>
      toListRow(input.namespace, snapshot.groupId, entry as never),
    )
    const detailRows: ExpenseDetailRow[] = snapshot.expenses.map((entry) => ({
      namespace: input.namespace,
      groupId: snapshot.groupId,
      id: entry.detail.id,
      record: entry.detail,
    }))
    const meta: GroupMetaRecord = {
      namespace: input.namespace,
      groupId: snapshot.groupId,
      schemaVersion: OFFLINE_DB_VERSION,
      serverRevision: snapshot.revision,
      capturedAt: snapshot.capturedAt,
      storedAt: new Date(),
      commitNonce: newCommitNonce(),
      dirtySince: null,
      lastConfirmedAt: new Date(),
      totalCount: snapshot.totalCount,
      hasMore: snapshot.hasMore,
      truncatedAt: snapshot.truncatedAt,
    }
    const data: GroupDataRecord = {
      namespace: input.namespace,
      groupId: snapshot.groupId,
      data: {
        group: snapshot.group,
        overview: snapshot.overview,
        global: snapshot.global,
        balances: snapshot.balances,
        subgroups: snapshot.subgroups,
        splitPresets: snapshot.splitPresets,
        budgets: snapshot.budgets,
        activities: snapshot.activities,
        activityTotalCount: snapshot.activityTotalCount,
        activityHasMore: snapshot.activityHasMore,
      },
    }

    const storedAt = meta.storedAt
    const commitNonce = meta.commitNonce
    try {
      await this.db.transaction(
        'rw',
        [
          this.db.controls,
          this.db.groupMeta,
          this.db.groupData,
          this.db.expenseList,
          this.db.expenseDetail,
          this.db.statuses,
        ],
        async () => {
          const controlRaw = await this.db.controls.get(input.namespace)
          const control = requireControl(
            controlRaw,
            input.namespace,
            input.generation,
          )
          requireNotRevoked(control)
          if (control.dataRevision !== input.expectedDataRevision) {
            // A concurrent markDirty (e.g. a confirmed delete) invalidates this
            // older capture entirely; callers restart the affected work instead
            // of marking the stale response dirty.
            throw new OfflineStorageError(
              'revision-changed',
              'revision-changed',
              {
                namespace: input.namespace,
                groupId: snapshot.groupId,
              },
            )
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

          // Replace the complete entity set: delete superseded rows, then put
          // the new ones. A crash or quota abort leaves old-or-new data.
          await this.deleteGroupRows(input.namespace, snapshot.groupId)
          await this.db.groupMeta.put(meta)
          await this.db.groupData.put(data)
          if (listRows.length > 0) await this.db.expenseList.bulkPut(listRows)
          if (detailRows.length > 0) {
            await this.db.expenseDetail.bulkPut(detailRows)
          }
          const status: GroupStatusRecord = {
            namespace: input.namespace,
            groupId: snapshot.groupId,
            updatedAt: storedAt,
            lastAttemptAt: storedAt,
            lastResult: 'ok',
            lastErrorCode: null,
          }
          await this.db.statuses.put(status)
        },
      )
      // Publish readiness only after the transaction commits.
      return { storedAt, commitNonce }
    } catch (error) {
      mapDexieError(error, {
        namespace: input.namespace,
        groupId: snapshot.groupId,
      })
    }
  }

  /**
   * Delete every entity row for one group. Must run inside the caller's
   * readwrite transaction so eviction stays atomic with its fencing.
   */
  private async deleteGroupRows(
    namespace: string,
    groupId: string,
  ): Promise<void> {
    const key: [string, string] = [namespace, groupId]
    await this.db.groupMeta.delete(key)
    await this.db.groupData.delete(key)
    await this.db.expenseList.where('[namespace+groupId]').equals(key).delete()
    await this.db.expenseDetail
      .where('[namespace+groupId]')
      .equals(key)
      .delete()
    await this.db.statuses.delete(key)
  }

  /**
   * Confirm an unchanged server revision without rewriting expenses. Advances
   * `lastConfirmedAt` only when the stored token still equals the published one
   * inside the same transaction (generation-fenced); the original content
   * capture (`capturedAt`) and every history row stay untouched. Dirty groups
   * are never confirmed: a local mutation after capture is not a trustworthy
   * server confirmation. Returns false (next pass refetches) when the group
   * vanished, changed under us, or is dirty.
   */
  async confirmGroup(input: {
    namespace: string
    generation: number
    groupId: string
    serverRevision: string
    now?: Date
  }): Promise<{ confirmed: boolean }> {
    const now = input.now ?? new Date()
    try {
      return await this.db.transaction(
        'rw',
        [this.db.controls, this.db.groupMeta],
        async () => {
          const controlRaw = await this.db.controls.get(input.namespace)
          const control = requireControl(
            controlRaw,
            input.namespace,
            input.generation,
          )
          requireNotRevoked(control)
          const meta = await this.db.groupMeta.get([
            input.namespace,
            input.groupId,
          ])
          if (!meta) return { confirmed: false }
          if (
            meta.serverRevision !== input.serverRevision ||
            meta.dirtySince !== null
          ) {
            return { confirmed: false }
          }
          await this.db.groupMeta.put({ ...meta, lastConfirmedAt: now })
          return { confirmed: true }
        },
      )
    } catch (error) {
      mapDexieError(error, {
        namespace: input.namespace,
        groupId: input.groupId,
      })
    }
  }

  async markDirty(input: MarkDirtyInput): Promise<{ dataRevision: number }> {
    const now = input.now ?? new Date()
    try {
      return await this.db.transaction(
        'rw',
        [
          this.db.controls,
          this.db.groupMeta,
          this.db.groupData,
          this.db.expenseList,
          this.db.expenseDetail,
          this.db.statuses,
        ],
        async () => {
          const controlRaw = await this.db.controls.get(input.namespace)
          const control = requireControl(
            controlRaw,
            input.namespace,
            input.generation,
          )
          requireNotRevoked(control)

          const dataRevision = control.dataRevision + 1
          await this.db.controls.put({ ...control, dataRevision })

          // Dirty metadata updates never rewrite history: only the metadata
          // row's dirty flag moves; expense rows stay byte-identical.
          for (const groupId of input.dirtyGroupIds) {
            const existing = await this.db.groupMeta.get([
              input.namespace,
              groupId,
            ])
            if (!existing) continue
            await this.db.groupMeta.put({ ...existing, dirtySince: now })
          }
          for (const groupId of input.removedGroupIds ?? []) {
            await this.deleteGroupRows(input.namespace, groupId)
          }
          return { dataRevision }
        },
      )
    } catch (error) {
      mapDexieError(error, { namespace: input.namespace })
    }
  }

  async evictGroup(input: EvictGroupInput): Promise<{ dataRevision: number }> {
    try {
      return await this.db.transaction(
        'rw',
        [
          this.db.controls,
          this.db.groupMeta,
          this.db.groupData,
          this.db.expenseList,
          this.db.expenseDetail,
          this.db.statuses,
        ],
        async () => {
          const controlRaw = await this.db.controls.get(input.namespace)
          const control = requireControl(
            controlRaw,
            input.namespace,
            input.generation,
          )
          // Eviction is cleanup: allow it for revoked namespaces, but still
          // bump dataRevision in the same transaction so a late snapshot
          // captured before eviction cannot resurrect the group.
          const dataRevision = control.dataRevision + 1
          await this.db.controls.put({ ...control, dataRevision })
          await this.deleteGroupRows(input.namespace, input.groupId)
          return { dataRevision }
        },
      )
    } catch (error) {
      mapDexieError(error, {
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
    try {
      return await this.db.transaction('rw', this.db.controls, async () => {
        const controlRaw = await this.db.controls.get(options.namespace)
        const control = requireControl(
          controlRaw,
          options.namespace,
          options.generation,
        )
        requireNotRevoked(control)
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
        await this.db.controls.put({
          ...control,
          leaseOwner: options.owner,
          leaseUntil,
        })
        return { leaseOwner: options.owner, leaseUntil }
      })
    } catch (error) {
      mapDexieError(error, { namespace: options.namespace })
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
    try {
      return await this.db.transaction('rw', this.db.controls, async () => {
        const controlRaw = await this.db.controls.get(options.namespace)
        const control = requireControl(
          controlRaw,
          options.namespace,
          options.generation,
        )
        requireNotRevoked(control)
        if (control.leaseOwner !== options.owner) {
          // Stolen after expiry or fenced by a reset: the old owner must
          // cancel and never commit again with this owner.
          throw new OfflineStorageError('lease-conflict', 'lease-conflict', {
            namespace: options.namespace,
          })
        }
        const leaseUntil = now + ttlMs
        await this.db.controls.put({ ...control, leaseUntil })
        return { leaseOwner: options.owner, leaseUntil }
      })
    } catch (error) {
      mapDexieError(error, { namespace: options.namespace })
    }
  }

  async releaseLease(options: {
    namespace: string
    generation: number
    owner: string
  }): Promise<void> {
    try {
      await this.db.transaction('rw', this.db.controls, async () => {
        const controlRaw = await this.db.controls.get(options.namespace)
        const control = requireControl(
          controlRaw,
          options.namespace,
          options.generation,
        )
        // Only the owner clears; never clear another tab's fresh lease.
        if (control.leaseOwner !== options.owner) return
        await this.db.controls.put({
          ...control,
          leaseOwner: null,
          leaseUntil: null,
        })
      })
    } catch (error) {
      mapDexieError(error, { namespace: options.namespace })
    }
  }

  /**
   * Atomic local expense deletion after a successful online delete.
   *
   * Removes the expense entity rows in the same transaction that bumps
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
    try {
      return await this.db.transaction(
        'rw',
        [
          this.db.controls,
          this.db.groupMeta,
          this.db.expenseList,
          this.db.expenseDetail,
        ],
        async () => {
          const controlRaw = await this.db.controls.get(options.namespace)
          const control = requireControl(
            controlRaw,
            options.namespace,
            options.generation,
          )
          // Cleanup path: allowed for revoked namespaces, but still bumps
          // dataRevision so late snapshots cannot resurrect the row.
          const dataRevision = control.dataRevision + 1
          await this.db.controls.put({ ...control, dataRevision })
          const key: [string, string, string] = [
            options.namespace,
            options.groupId,
            options.expenseId,
          ]
          const existingList = await this.db.expenseList.get(key)
          await this.db.expenseList.delete(key)
          await this.db.expenseDetail.delete(key)
          const meta = await this.db.groupMeta.get([
            options.namespace,
            options.groupId,
          ])
          if (meta) {
            await this.db.groupMeta.put({
              ...meta,
              commitNonce: newCommitNonce(),
              dirtySince: now,
              totalCount: existingList
                ? Math.max(0, meta.totalCount - 1)
                : meta.totalCount,
            })
          }
          return { dataRevision }
        },
      )
    } catch (error) {
      mapDexieError(error, {
        namespace: options.namespace,
        groupId: options.groupId,
      })
    }
  }

  /**
   * Immediate local group eviction after a successful online delete/leave.
   * Deletes the group entities + status and removes its catalog entry in one
   * transaction while bumping `dataRevision` so older downloads cannot
   * resurrect it. Never touches SW caches, appearance, or server data.
   */
  async deleteGroupLocally(options: {
    namespace: string
    generation: number
    groupId: string
  }): Promise<{ dataRevision: number }> {
    try {
      return await this.db.transaction(
        'rw',
        [
          this.db.controls,
          this.db.catalogs,
          this.db.groupMeta,
          this.db.groupData,
          this.db.expenseList,
          this.db.expenseDetail,
          this.db.statuses,
        ],
        async () => {
          const controlRaw = await this.db.controls.get(options.namespace)
          const control = requireControl(
            controlRaw,
            options.namespace,
            options.generation,
          )
          const dataRevision = control.dataRevision + 1
          await this.db.controls.put({ ...control, dataRevision })
          await this.deleteGroupRows(options.namespace, options.groupId)
          const catalogRaw = await this.db.catalogs.get(options.namespace)
          if (catalogRaw) {
            const parsed = catalogRecordSchema.safeParse(catalogRaw)
            if (parsed.success) {
              const remaining = parsed.data.groups.filter(
                (entry) => entry.overview.id !== options.groupId,
              )
              if (remaining.length !== parsed.data.groups.length) {
                await this.db.catalogs.put({
                  ...parsed.data,
                  groups: remaining,
                })
              }
            }
          }
          return { dataRevision }
        },
      )
    } catch (error) {
      mapDexieError(error, {
        namespace: options.namespace,
        groupId: options.groupId,
      })
    }
  }

  async revokeNamespace(options: {
    namespace: string
    generation: number
  }): Promise<{ generation: number }> {
    const tables = [
      this.db.controls,
      this.db.catalogs,
      this.db.groupMeta,
      this.db.groupData,
      this.db.expenseList,
      this.db.expenseDetail,
      this.db.statuses,
    ] as const
    try {
      return await this.db.transaction('rw', tables as never, async () => {
        const existingRaw = await this.db.controls.get(options.namespace)
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
          await this.db.controls.put({
            ...created,
            generation,
            revoked: true,
          })
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
        await this.db.controls.put({
          ...existing,
          generation,
          revoked: true,
          leaseOwner: null,
          leaseUntil: null,
        })
        await this.deleteNamespaceRows(options.namespace)
        return { generation }
      })
    } catch (error) {
      mapDexieError(error, { namespace: options.namespace })
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
    try {
      await this.db.transaction(
        'rw',
        [this.db.controls, this.db.statuses],
        async () => {
          const controlRaw = await this.db.controls.get(options.namespace)
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
          await this.db.statuses.put(status)
        },
      )
    } catch (error) {
      mapDexieError(error, {
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
   * dataRevision/lease for the new empty lifecycle, and clears the revoked
   * flag. Callers clear the localStorage revocation marker only after this
   * resolves.
   */
  async reactivateNamespace(options: {
    namespace: string
  }): Promise<{ generation: number }> {
    const tables = [
      this.db.controls,
      this.db.catalogs,
      this.db.groupMeta,
      this.db.groupData,
      this.db.expenseList,
      this.db.expenseDetail,
      this.db.statuses,
    ] as const
    try {
      return await this.db.transaction('rw', tables as never, async () => {
        const existingRaw = await this.db.controls.get(options.namespace)
        if (!existingRaw) {
          const created = newControlRecord(options.namespace)
          const generation = 1
          await this.db.controls.put({
            ...created,
            generation,
            dataRevision: 0,
            leaseOwner: null,
            leaseUntil: null,
            revoked: false,
          })
          return { generation }
        }
        const parsed = controlRecordSchema.safeParse(existingRaw)
        if (!parsed.success) {
          throw new OfflineStorageError('corrupt-record', 'corrupt-record', {
            namespace: options.namespace,
          })
        }
        const existing = parsed.data
        if (!existing.revoked) {
          return { generation: existing.generation }
        }
        const generation = existing.generation + 1
        await this.db.controls.put({
          ...existing,
          generation,
          dataRevision: 0,
          leaseOwner: null,
          leaseUntil: null,
          revoked: false,
        })
        await this.deleteNamespaceRows(options.namespace)
        return { generation }
      })
    } catch (error) {
      mapDexieError(error, { namespace: options.namespace })
    }
  }

  /** Delete every group-scoped row for a namespace. Caller holds the write tx. */
  private async deleteNamespaceRows(namespace: string): Promise<void> {
    await this.db.catalogs.delete(namespace)
    await this.db.groupMeta.where('namespace').equals(namespace).delete()
    await this.db.groupData.where('namespace').equals(namespace).delete()
    await this.db.expenseList.where('namespace').equals(namespace).delete()
    await this.db.expenseDetail.where('namespace').equals(namespace).delete()
    await this.db.statuses.where('namespace').equals(namespace).delete()
  }
}

export type { OfflineErrorCode }

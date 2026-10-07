import { Dexie, type Table } from 'dexie'

import {
  OFFLINE_DB_NAME,
  OFFLINE_DB_VERSION,
  type CatalogRecord,
  type ControlRecord,
  type ExpenseDetailRow,
  type ExpenseListRow,
  type GroupDataRecord,
  type GroupMetaRecord,
  type GroupStatusRecord,
} from './contract'
import { OfflineStorageError, isQuotaError } from './errors'

/**
 * Dexie entity database for read-only offline snapshots.
 *
 * Sole direct IndexedDB wrapper for the application: no caller opens IndexedDB
 * or imports raw IDB factories. Version upgrades are sequential
 * (version(n).stores(...) plus an upgrade step per bump):
 *
 * - Compatible old formats transform inside the upgrade transaction.
 * - Replacement-required old formats are retained until a fresh commit succeeds;
 *   the upgrade never deletes user data as a shortcut.
 * - A newer unsupported database (higher version than this client declares) is
 *   left untouched and opening fails closed with a compatibility state instead
 *   of migrating anything.
 *
 * Opening performs exactly one attempt: blocked (another tab holds the database
 * open during an upgrade) and versionchange (an upgrade is waiting on us)
 * report through callbacks for silent foreground recovery. Unexpected closes
 * surface as storage errors on the next operation; quota failures stop writes
 * while preserving reads, with no eviction or retry loop.
 *
 * Version spaces: Dexie maps declared versions to IDB-level numbers internally,
 * so raw IDB version reads must never own the compatibility check. The
 * post-open db.verno guard below compares in Dexie's own version space
 * instead.
 */
/**
 * Versioned store declarations shared by the production database and by tests
 * that simulate upgrades from newer clients. Declared once so the two can never
 * drift: a newer-client simulation uses these same stores.
 */
export const OFFLINE_DB_STORES: { [tableName: string]: string } = {
  controls: '&namespace',
  catalogs: '&namespace',
  groupMeta: '&[namespace+groupId], namespace',
  groupData: '&[namespace+groupId], namespace',
  expenseList:
    '&[namespace+groupId+id], [namespace+groupId], namespace, ' +
    '[namespace+groupId+expenseDateMs+createdAtMs+id], ' +
    '[namespace+groupId+amount+id], ' +
    '[namespace+groupId+categoryId+id]',
  expenseDetail: '&[namespace+groupId+id], [namespace+groupId], namespace',
  statuses: '&[namespace+groupId], namespace',
}

export class OfflineDexieDatabase extends Dexie {
  controls!: Table<ControlRecord, string>
  catalogs!: Table<CatalogRecord, string>
  groupMeta!: Table<GroupMetaRecord, [string, string]>
  groupData!: Table<GroupDataRecord, [string, string]>
  expenseList!: Table<ExpenseListRow, [string, string, string]>
  expenseDetail!: Table<ExpenseDetailRow, [string, string, string]>
  statuses!: Table<GroupStatusRecord, [string, string]>

  constructor(name: string = OFFLINE_DB_NAME) {
    super(name)
    this.version(OFFLINE_DB_VERSION).stores(OFFLINE_DB_STORES)
  }
}

export type OpenDexieOptions = {
  name?: string
  onBlocked?: () => void
  onVersionChange?: () => void
  signal?: AbortSignal
}

/** Map any open/operation failure to a typed storage error. Never rethrows. */
export function mapDexieError(
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
  const name =
    error && typeof error === 'object' && 'name' in error
      ? String(error.name)
      : ''
  if (name === 'VersionError' || name === 'SchemaError') {
    throw new OfflineStorageError('schema-unsupported', 'schema-unsupported', {
      ...options,
      cause: error,
    })
  }
  throw new OfflineStorageError('storage-unavailable', 'storage-unavailable', {
    ...options,
    cause: error,
  })
}

async function readStoredDexieVersion(
  name: string,
  signal?: AbortSignal,
): Promise<number> {
  if (signal?.aborted) {
    throw new OfflineStorageError('storage-unavailable', 'storage-unavailable')
  }
  // Avoid creating an empty database as a side effect: when the listings API
  // exists and the name is absent, there is nothing newer to detect.
  try {
    const databases = await (
      indexedDB as unknown as {
        databases?: () => Promise<Array<{ name?: string }>>
      }
    ).databases?.()
    if (databases && !databases.some((entry) => entry?.name === name)) {
      return 0
    }
  } catch {
    // Listings unavailable (e.g. private mode); fall through to raw open.
  }
  const raw = await new Promise<IDBDatabase>((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      // Timeout (e.g. blocked with no event in some engines): fall through
      // to the Dexie open via a plain error the caller swallows.
      reject(new Error('__offline-version-check-timeout__'))
    }, 3000)
    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(name)
    } catch (error) {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        reject(error)
      }
      return
    }
    const finishResolve = (db: IDBDatabase) => {
      if (settled) {
        try {
          db.close()
        } catch {}
        return
      }
      settled = true
      clearTimeout(timer)
      resolve(db)
    }
    const finishReject = (error: unknown) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    }
    request.onupgradeneeded = () => {}
    request.onsuccess = () => finishResolve(request.result)
    request.onerror = () => finishReject(request.error)
    // Blocked (another tab holds the DB for an upgrade) must not hang the
    // open: fall through to the Dexie open, which reports `blocked` via its
    // own callback for silent foreground recovery.
    request.onblocked = () =>
      finishReject(new Error('__offline-version-check-blocked__'))
    signal?.addEventListener(
      'abort',
      () =>
        finishReject(
          new OfflineStorageError('storage-unavailable', 'storage-unavailable'),
        ),
      { once: true },
    )
  })
  const version = raw.version
  // Dexie maps declared versions to IDB-level numbers (x10) to support one
  // decimal of sub-versions, so normalize back to declared space. A raw
  // shell from database creation reads back below 1 and never blocks open.
  try {
    raw.close()
  } catch {}
  return Math.floor(version / 10)
}

export async function openOfflineDatabase(
  options?: OpenDexieOptions,
): Promise<OfflineDexieDatabase> {
  if (options?.signal?.aborted) {
    throw new OfflineStorageError('storage-unavailable', 'storage-unavailable')
  }
  const { onBlocked, onVersionChange, signal } = options ?? {}
  try {
    if (
      (await readStoredDexieVersion(
        options?.name ?? OFFLINE_DB_NAME,
        options?.signal,
      )) > OFFLINE_DB_VERSION
    ) {
      throw new OfflineStorageError('schema-unsupported', 'schema-unsupported')
    }
  } catch (error) {
    if (error instanceof OfflineStorageError) throw error
    // Raw version-read failures (blocked, timeout, abort, security) fall
    // through to the Dexie open below, which fails closed via mapDexieError.
    // A newer-client DB plus a raw-read failure reports storage-unavailable
    // rather than schema-unsupported — honest, since the version is unknown.
  }
  const db = new OfflineDexieDatabase(options?.name)
  db.on('blocked', () => {
    onBlocked?.()
  })
  db.on('versionchange', () => {
    try {
      db.close()
    } catch {}
    onVersionChange?.()
  })
  try {
    await db.open()
  } catch (error) {
    mapDexieError(error)
  }
  if (db.verno > OFFLINE_DB_VERSION) {
    try {
      db.close()
    } catch {}
    throw new OfflineStorageError('schema-unsupported', 'schema-unsupported')
  }
  if (signal?.aborted) {
    try {
      db.close()
    } catch {}
    throw new OfflineStorageError('storage-unavailable', 'storage-unavailable')
  }
  return db
}

/** Test-only database reset. Production recovery never wipes. */
export async function deleteOfflineDatabaseForTests(
  name: string = OFFLINE_DB_NAME,
): Promise<void> {
  await Dexie.delete(name)
}

/**
 * Scope helpers: every group-scoped table carries a namespace index, so
 * per-namespace eviction never scans unrelated accounts.
 */
export async function listGroupIdsForNamespace(
  db: OfflineDexieDatabase,
  namespace: string,
): Promise<string[]> {
  const metas = await db.groupMeta
    .where('namespace')
    .equals(namespace)
    .primaryKeys()
  return metas.map(([, groupId]) => groupId).sort()
}

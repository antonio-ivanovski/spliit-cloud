/**
 * Pending-share staging for the PWA Web Share Target (issue #159).
 *
 * A shared file arrives as a `POST` to the service worker, which cannot hand a
 * multipart body to a page directly. The worker therefore stages the payload
 * here and `303`-redirects to `/share-target/?share=<id>`, where the page picks
 * it up. Text-only shares (title/text/url) travel the same path so file and
 * text handling stays uniform.
 *
 * Raw IndexedDB on purpose: this module is imported by the service worker
 * (`sw.ts`), so it must stay free of window-only APIs and of Dexie (the offline
 * entity database owns its own versioned schema in `offline/database.ts`; a
 * separate tiny database cannot interfere with it).
 */

export const SHARE_TARGET_DB_NAME = 'spliit-share-target'
export const SHARE_TARGET_DB_VERSION = 1
export const SHARE_TARGET_STORE_NAME = 'pending-shares'
/**
 * Manifest `params.files` field name; must match `share_target` in
 * vite.config.ts.
 */
export const SHARE_TARGET_FILES_FIELD = 'receipts'
/** Staged shares older than this are treated as expired and dropped on read. */
export const SHARE_TARGET_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
/** Cap on files kept per share; the page handles one file per flow step. */
export const SHARE_TARGET_MAX_FILES = 10
/** Cap on staged text length so a runaway share cannot bloat the store. */
export const SHARE_TARGET_MAX_TEXT_LENGTH = 20_000

export type PendingShareFile = {
  name: string
  type: string
  size: number
  blob: Blob
}

export type PendingShare = {
  id: string
  createdAt: number
  title: string | null
  text: string | null
  url: string | null
  files: PendingShareFile[]
}

export type PendingShareInput = {
  id?: string
  createdAt?: number
  title?: string | null
  text?: string | null
  url?: string | null
  files?: PendingShareFile[]
}

function idbFactory(): IDBFactory | null {
  const factory = (globalThis as { indexedDB?: IDBFactory }).indexedDB
  return factory ?? null
}

function newShareId(): string {
  const cryptoRef = (globalThis as { crypto?: Crypto }).crypto
  if (cryptoRef && 'randomUUID' in cryptoRef) return cryptoRef.randomUUID()
  return `share-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function openDatabase(): Promise<IDBDatabase> {
  const factory = idbFactory()
  if (!factory) return Promise.reject(new Error('IndexedDB is unavailable'))
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest
    try {
      request = factory.open(SHARE_TARGET_DB_NAME, SHARE_TARGET_DB_VERSION)
    } catch (error) {
      reject(error)
      return
    }
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(SHARE_TARGET_STORE_NAME)) {
        db.createObjectStore(SHARE_TARGET_STORE_NAME, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(request.error ?? new Error('IndexedDB open failed'))
    request.onblocked = () => reject(new Error('IndexedDB open blocked'))
  })
}

function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDatabase().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        let settled = false
        const fail = (error: unknown) => {
          if (settled) return
          settled = true
          try {
            db.close()
          } catch {
            // Close is best-effort; the rejection below carries the outcome.
          }
          reject(error)
        }
        const transaction = db.transaction(SHARE_TARGET_STORE_NAME, mode)
        transaction.oncomplete = () => {
          try {
            db.close()
          } catch {
            // Close is best-effort.
          }
        }
        transaction.onerror = () =>
          fail(transaction.error ?? new Error('IndexedDB transaction failed'))
        transaction.onabort = () =>
          fail(transaction.error ?? new Error('IndexedDB transaction aborted'))
        let request: IDBRequest<T>
        try {
          request = run(transaction.objectStore(SHARE_TARGET_STORE_NAME))
        } catch (error) {
          fail(error)
          return
        }
        request.onsuccess = () => {
          if (settled) return
          settled = true
          resolve(request.result)
        }
        request.onerror = () =>
          fail(request.error ?? new Error('IndexedDB request failed'))
      }),
  )
}

function truncateText(value: string | null | undefined): string | null {
  if (value == null) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.length > SHARE_TARGET_MAX_TEXT_LENGTH
    ? trimmed.slice(0, SHARE_TARGET_MAX_TEXT_LENGTH)
    : trimmed
}

function firstString(value: FormDataEntryValue | null): string | null {
  return typeof value === 'string' ? value : null
}

/**
 * Map a share-target `POST` body to a storable input. Files arrive under the
 * manifest field name; Android often delivers a shared URL inside `text`, so
 * callers treat `text` as free-form content rather than a pure note.
 */
export function extractPendingShareInput(formData: FormData): {
  title: string | null
  text: string | null
  url: string | null
  files: PendingShareFile[]
} {
  const files: PendingShareFile[] = []
  for (const entry of formData.getAll(SHARE_TARGET_FILES_FIELD)) {
    if (files.length >= SHARE_TARGET_MAX_FILES) break
    if (typeof entry === 'string') continue
    const file = entry as File
    if (file.size <= 0) continue
    files.push({
      name: file.name || 'receipt',
      type: file.type,
      size: file.size,
      blob: file,
    })
  }
  return {
    title: truncateText(firstString(formData.get('title'))),
    text: truncateText(firstString(formData.get('text'))),
    url: truncateText(firstString(formData.get('url'))),
    files,
  }
}

/** True when a share carries nothing worth staging. */
export function hasPendingShareContent(input: {
  title: string | null
  text: string | null
  url: string | null
  files: PendingShareFile[]
}): boolean {
  return (
    input.files.length > 0 ||
    input.title != null ||
    input.text != null ||
    input.url != null
  )
}

export async function putPendingShare(
  input: PendingShareInput,
): Promise<string> {
  const entry: PendingShare = {
    id: input.id ?? newShareId(),
    createdAt: input.createdAt ?? Date.now(),
    title: truncateText(input.title) ?? null,
    text: truncateText(input.text) ?? null,
    url: truncateText(input.url) ?? null,
    files: (input.files ?? []).slice(0, SHARE_TARGET_MAX_FILES),
  }
  await withStore('readwrite', (store) => store.put(entry))
  return entry.id
}

/**
 * Read a staged share; expired entries are deleted and reported as missing so
 * stale system shares never resurrect.
 */
export async function getPendingShare(
  id: string,
): Promise<PendingShare | null> {
  const entry = await withStore<PendingShare | undefined>('readonly', (store) =>
    store.get(id),
  )
  if (!entry) return null
  if (Date.now() - entry.createdAt > SHARE_TARGET_MAX_AGE_MS) {
    await deletePendingShare(id).catch(() => undefined)
    return null
  }
  return entry
}

export async function deletePendingShare(id: string): Promise<void> {
  await withStore('readwrite', (store) => store.delete(id))
}

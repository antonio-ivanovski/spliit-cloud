# Offline-First — Synchronization Examples

> Reconciling a local record with a server that moved on. Decisions are in
> [SKILL.md](../SKILL.md); the queue that drives all of this is in [core.md](core.md).

---

## Pattern 17: Last-write-wins

The cheapest strategy. Prefer server timestamps where both sides have one, and require the local
side to be newer by more than the clock-drift tolerance before it wins — otherwise a fast client
clock silently takes every tie.

```typescript
// sync/last-write-wins.ts
interface SyncableEntity {
  id: string;
  _lastModified: number;
  _serverTimestamp?: number;
  _localVersion: string;
  _serverVersion?: string;
  _syncStatus: "synced" | "pending" | "conflicted";
}

interface ConflictResult<T> {
  resolved: T;
  winner: "local" | "server";
  loser: T;
}

const CLOCK_DRIFT_TOLERANCE_MS = 5000;

function resolveWithLWW<T extends SyncableEntity>(
  local: T,
  server: T,
): ConflictResult<T> {
  const localTime = local._serverTimestamp ?? local._lastModified;
  const serverTime = server._serverTimestamp ?? server._lastModified;

  const localIsNewer = localTime > serverTime + CLOCK_DRIFT_TOLERANCE_MS;

  if (localIsNewer) {
    return {
      resolved: {
        ...local,
        _syncStatus: "synced" as const,
        _serverVersion: server._serverVersion,
      },
      winner: "local",
      loser: server,
    };
  }

  return {
    resolved: {
      ...server,
      _syncStatus: "synced" as const,
      _localVersion: local._localVersion,
    },
    winner: "server",
    loser: local,
  };
}

export { resolveWithLWW };
export type { ConflictResult };
```

---

## Pattern 18: Field-level merge

Compare each side against the last common state rather than against each other. A field only one
side touched is not a conflict, which is what makes this worth the extra bookkeeping: two people
editing different fields of one record both keep their work.

```typescript
// sync/field-merge.ts
interface FieldChange {
  field: string;
  localValue: unknown;
  serverValue: unknown;
  localTimestamp: number;
  serverTimestamp: number;
}

interface MergeResult<T> {
  merged: T;
  autoResolved: FieldChange[];
  conflicts: FieldChange[];
}

const SYNC_METADATA_FIELDS = [
  "_syncStatus",
  "_lastModified",
  "_localVersion",
  "_serverVersion",
  "_serverTimestamp",
  "_deletedAt",
  "id",
] as const;

function mergeFields<T extends Record<string, unknown>>(
  base: T, // last known common state
  local: T,
  server: T,
  localTimestamp: number,
  serverTimestamp: number,
): MergeResult<T> {
  const merged = { ...base } as T;
  const autoResolved: FieldChange[] = [];
  const conflicts: FieldChange[] = [];

  const allFields = new Set([...Object.keys(local), ...Object.keys(server)]);

  for (const field of allFields) {
    if (
      SYNC_METADATA_FIELDS.includes(
        field as (typeof SYNC_METADATA_FIELDS)[number],
      )
    ) {
      continue;
    }

    const baseValue = base[field];
    const localValue = local[field];
    const serverValue = server[field];

    const localChanged = !deepEqual(baseValue, localValue);
    const serverChanged = !deepEqual(baseValue, serverValue);
    const change = {
      field,
      localValue,
      serverValue,
      localTimestamp,
      serverTimestamp,
    };

    if (!localChanged && !serverChanged) continue;

    if (localChanged && !serverChanged) {
      (merged as Record<string, unknown>)[field] = localValue;
      autoResolved.push(change);
    } else if (!localChanged && serverChanged) {
      (merged as Record<string, unknown>)[field] = serverValue;
      autoResolved.push(change);
    } else if (deepEqual(localValue, serverValue)) {
      // both moved to the same value — agreement, not conflict
      (merged as Record<string, unknown>)[field] = localValue;
    } else {
      conflicts.push(change);
      // server wins provisionally; the conflict list is what gets surfaced
      (merged as Record<string, unknown>)[field] = serverValue;
    }
  }

  return { merged, autoResolved, conflicts };
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== "object") return a === b;

  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);

  if (aKeys.length !== Object.keys(bObj).length) return false;

  return aKeys.every((key) => deepEqual(aObj[key], bObj[key]));
}

export { mergeFields };
export type { FieldChange, MergeResult };
```

This needs the base state stored alongside the record. Without it, every difference looks like a
conflict.

---

## Pattern 19: Conflict resolution UI

Per-field choice, with a timestamp on each option so the user has something to decide on. Submit
stays disabled until every conflict is answered.

```tsx
// components/conflict-resolver.tsx
import { useState, type ReactNode } from "react";
import type { FieldChange } from "../sync/field-merge";

interface ConflictResolverProps<T> {
  entityName: string;
  localEntity: T;
  serverEntity: T;
  conflicts: FieldChange[];
  onResolve: (resolved: T) => Promise<void>;
  onCancel: () => void;
  renderField?: (field: string, value: unknown) => ReactNode;
}

type Resolution = "local" | "server";

function ConflictResolver<T extends Record<string, unknown>>({
  entityName,
  localEntity,
  serverEntity,
  conflicts,
  onResolve,
  onCancel,
  renderField = (field, value) => JSON.stringify(value),
}: ConflictResolverProps<T>) {
  const [resolutions, setResolutions] = useState<Map<string, Resolution>>(
    new Map(),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  const allResolved = conflicts.every((c) => resolutions.has(c.field));

  const handleFieldResolution = (field: string, choice: Resolution) => {
    setResolutions((prev) => new Map(prev).set(field, choice));
  };

  const handleSubmit = async () => {
    if (!allResolved) return;

    setIsSubmitting(true);
    try {
      const resolved = { ...serverEntity };
      for (const [field, choice] of resolutions) {
        if (choice === "local") {
          (resolved as Record<string, unknown>)[field] = localEntity[field];
        }
      }

      await onResolve(resolved as T);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-labelledby="conflict-title"
      aria-describedby="conflict-description"
    >
      <h2 id="conflict-title">Resolve Sync Conflict</h2>
      <p id="conflict-description">
        The {entityName} was modified both locally and on the server. Choose
        which version to keep for each field.
      </p>

      <div role="list" aria-label="Conflicting fields">
        {conflicts.map((conflict) => (
          <div key={conflict.field} role="listitem" data-field={conflict.field}>
            <h3>{formatFieldName(conflict.field)}</h3>

            <fieldset>
              <legend>Choose version for {conflict.field}</legend>

              <label>
                <input
                  type="radio"
                  name={`conflict-${conflict.field}`}
                  value="local"
                  checked={resolutions.get(conflict.field) === "local"}
                  onChange={() =>
                    handleFieldResolution(conflict.field, "local")
                  }
                />
                <span>Your changes</span>
                <span aria-label="Local value">
                  {renderField(conflict.field, conflict.localValue)}
                </span>
                <time
                  dateTime={new Date(conflict.localTimestamp).toISOString()}
                >
                  {formatTimestamp(conflict.localTimestamp)}
                </time>
              </label>

              <label>
                <input
                  type="radio"
                  name={`conflict-${conflict.field}`}
                  value="server"
                  checked={resolutions.get(conflict.field) === "server"}
                  onChange={() =>
                    handleFieldResolution(conflict.field, "server")
                  }
                />
                <span>Server version</span>
                <span aria-label="Server value">
                  {renderField(conflict.field, conflict.serverValue)}
                </span>
                <time
                  dateTime={new Date(conflict.serverTimestamp).toISOString()}
                >
                  {formatTimestamp(conflict.serverTimestamp)}
                </time>
              </label>
            </fieldset>
          </div>
        ))}
      </div>

      <div role="group" aria-label="Actions">
        <button type="button" onClick={onCancel} disabled={isSubmitting}>
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!allResolved || isSubmitting}
          aria-describedby={!allResolved ? "resolve-all-hint" : undefined}
        >
          {isSubmitting ? "Saving..." : "Apply Resolution"}
        </button>
        {!allResolved && (
          <span id="resolve-all-hint">
            Please resolve all {conflicts.length - resolutions.size} remaining
            conflicts
          </span>
        )}
      </div>
    </div>
  );
}

function formatFieldName(field: string): string {
  return field
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (str) => str.toUpperCase())
    .trim();
}

function formatTimestamp(ts: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(ts));
}

export { ConflictResolver };
export type { ConflictResolverProps };
```

---

## Pattern 20: Version vectors

A counter per client, incremented on every local write. Comparing two vectors answers a question
timestamps cannot: whether one edit happened _after_ the other, or whether they happened without
knowledge of each other.

```typescript
// sync/version-vector.ts
type VersionVector = Record<string, number>;

interface VersionedEntity {
  id: string;
  _versionVector: VersionVector;
  _nodeId: string;
}

function getNodeId(): string {
  const STORAGE_KEY = "offline-first-node-id";
  let nodeId = localStorage.getItem(STORAGE_KEY);

  if (!nodeId) {
    nodeId = crypto.randomUUID();
    localStorage.setItem(STORAGE_KEY, nodeId);
  }

  return nodeId;
}

const NODE_ID = getNodeId();

function incrementVersion(vector: VersionVector): VersionVector {
  return { ...vector, [NODE_ID]: (vector[NODE_ID] ?? 0) + 1 };
}

/** Merge takes the highest counter each node has reached. */
function mergeVectors(a: VersionVector, b: VersionVector): VersionVector {
  const merged: VersionVector = { ...a };

  for (const [node, version] of Object.entries(b)) {
    merged[node] = Math.max(merged[node] ?? 0, version);
  }

  return merged;
}

type CompareResult = "before" | "after" | "concurrent" | "equal";

function compareVectors(a: VersionVector, b: VersionVector): CompareResult {
  let aBeforeB = true;
  let bBeforeA = true;

  const allNodes = new Set([...Object.keys(a), ...Object.keys(b)]);

  for (const node of allNodes) {
    const aVersion = a[node] ?? 0;
    const bVersion = b[node] ?? 0;

    if (aVersion > bVersion) bBeforeA = false;
    if (bVersion > aVersion) aBeforeB = false;
  }

  // neither side has a counter the other lacks: the vectors are identical
  if (aBeforeB && bBeforeA) return "equal";
  if (aBeforeB) return "before";
  if (bBeforeA) return "after";
  // neither dominates: each side has a counter the other has not seen
  return "concurrent";
}

function needsSync(
  local: VersionedEntity,
  server: VersionedEntity,
): { needsUpload: boolean; needsDownload: boolean; hasConflict: boolean } {
  const comparison = compareVectors(
    local._versionVector,
    server._versionVector,
  );

  return {
    needsUpload: comparison === "after",
    needsDownload: comparison === "before",
    hasConflict: comparison === "concurrent",
  };
}

export {
  getNodeId,
  NODE_ID,
  incrementVersion,
  mergeVectors,
  compareVectors,
  needsSync,
};
export type { VersionVector, VersionedEntity, CompareResult };
```

The vector grows with the number of clients that have ever written the record, so prune entries for
retired nodes if that number is unbounded.

---

## Pattern 21: Delta sync

Ask for what changed since last time. The cursor is persisted, so a reload does not re-download the
collection.

```typescript
// sync/delta-sync.ts
interface SyncCursor {
  collection: string;
  lastSyncTimestamp: number;
  lastServerId?: string;
}

interface DeltaSyncResult<T> {
  items: T[];
  hasMore: boolean;
  nextCursor: SyncCursor;
  serverTimestamp: number;
}

const DEFAULT_BATCH_SIZE = 100;
const CURSOR_STORAGE_KEY = "sync-cursors";

class DeltaSyncManager {
  private cursors: Map<string, SyncCursor>;

  constructor() {
    this.cursors = this.loadCursors();
  }

  private loadCursors(): Map<string, SyncCursor> {
    try {
      const stored = localStorage.getItem(CURSOR_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Record<string, SyncCursor>;
        return new Map(Object.entries(parsed));
      }
    } catch {
      console.warn("Failed to load sync cursors");
    }
    return new Map();
  }

  private saveCursors(): void {
    localStorage.setItem(
      CURSOR_STORAGE_KEY,
      JSON.stringify(Object.fromEntries(this.cursors)),
    );
  }

  getCursor(collection: string): SyncCursor {
    return this.cursors.get(collection) ?? { collection, lastSyncTimestamp: 0 };
  }

  updateCursor(cursor: SyncCursor): void {
    this.cursors.set(cursor.collection, cursor);
    this.saveCursors();
  }

  async fetchDelta<T>(
    collection: string,
    fetcher: (
      cursor: SyncCursor,
      batchSize: number,
    ) => Promise<DeltaSyncResult<T>>,
    options: { batchSize?: number } = {},
  ): Promise<T[]> {
    const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    const allItems: T[] = [];
    let cursor = this.getCursor(collection);

    while (true) {
      const result = await fetcher(cursor, batchSize);
      allItems.push(...result.items);

      // save after every page, so an interrupted sync resumes mid-collection
      this.updateCursor(result.nextCursor);
      cursor = result.nextCursor;

      if (!result.hasMore) break;
    }

    return allItems;
  }

  resetCursor(collection: string): void {
    this.cursors.delete(collection);
    this.saveCursors();
  }
}

async function fetchTodosDelta(
  cursor: SyncCursor,
  batchSize: number,
): Promise<DeltaSyncResult<Todo>> {
  const params = new URLSearchParams({
    since: cursor.lastSyncTimestamp.toString(),
    limit: batchSize.toString(),
    ...(cursor.lastServerId && { after: cursor.lastServerId }),
  });

  const response = await fetch(`/api/todos/sync?${params}`);
  if (!response.ok) throw new Error(`Sync failed: ${response.status}`);

  const data = await response.json();

  return {
    items: data.items,
    hasMore: data.hasMore,
    serverTimestamp: data.serverTimestamp,
    nextCursor: {
      collection: "todos",
      lastSyncTimestamp: data.serverTimestamp,
      lastServerId: data.items.at(-1)?.id ?? cursor.lastServerId,
    },
  };
}

export { DeltaSyncManager, fetchTodosDelta };
export type { SyncCursor, DeltaSyncResult };
```

The timestamp comes from the server, never from the client — a client clock ahead of the server's
would skip records written in the gap.

---

## Pattern 22: Background sync

Background Sync lets the browser retry a queued sync after the tab is closed. It is Chromium-only,
so the `online` listener is the mechanism everywhere else and this is the enhancement on top.

```typescript
// service-worker/sync-handler.ts
const SYNC_TAG_PREFIX = "sync-";

async function registerBackgroundSync(collection: string): Promise<void> {
  if (!("sync" in self.registration)) return;

  try {
    await self.registration.sync.register(`${SYNC_TAG_PREFIX}${collection}`);
  } catch {
    // registration refused — the online listener still covers this
  }
}

self.addEventListener("sync", (event: SyncEvent) => {
  if (!event.tag.startsWith(SYNC_TAG_PREFIX)) return;

  const collection = event.tag.slice(SYNC_TAG_PREFIX.length);

  // a rejected promise tells the browser to retry with its own backoff
  event.waitUntil(processSyncQueue(collection));
});

async function processSyncQueue(collection: string): Promise<void> {
  const db = await openDatabase();
  const operations = await db.getAll("syncQueue");

  for (const op of operations.filter((o) => o.collection === collection)) {
    try {
      await executeOperation(op);
      await db.delete("syncQueue", op.id);
    } catch (error) {
      await db.put("syncQueue", {
        ...op,
        retryCount: op.retryCount + 1,
        lastError: error instanceof Error ? error.message : "Unknown",
      });

      // exhausted operations stay queued for manual handling
      if (op.retryCount >= 4) continue;
      throw error;
    }
  }
}

async function executeOperation(op: QueuedOperation): Promise<void> {
  const methods: Record<string, string> = {
    CREATE: "POST",
    UPDATE: "PUT",
    DELETE: "DELETE",
    UPSERT: "PUT",
  };

  const response = await fetch(`/api/${op.collection}`, {
    method: methods[op.type],
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(op.data),
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

declare global {
  interface ServiceWorkerRegistration {
    readonly sync: SyncManager;
  }
  interface SyncManager {
    register(tag: string): Promise<void>;
  }
  interface SyncEvent extends ExtendableEvent {
    readonly tag: string;
  }
}

export { registerBackgroundSync };
```

The fallback, which every browser runs:

```typescript
// client/register-sync.ts
async function requestSyncWhenOnline(collection: string): Promise<void> {
  if (!navigator.onLine) return;

  const registration = await navigator.serviceWorker.ready;

  if ("sync" in registration) {
    await registration.sync.register(`sync-${collection}`);
  } else {
    await syncCollection(collection);
  }
}

function setupSyncFallback(syncFn: () => Promise<void>): void {
  window.addEventListener("online", async () => {
    try {
      await syncFn();
    } catch (error) {
      console.error("Sync fallback failed:", error);
    }
  });
}

export { requestSyncWhenOnline, setupSyncFallback };
```

---

## Pattern 23: Pull-push

Pull before pushing. Applying server changes first means a conflict is detected before the local
version overwrites it, rather than after.

```typescript
// sync/pull-push-sync.ts
interface SyncResult {
  uploaded: number;
  downloaded: number;
  conflicts: number;
  errors: string[];
}

const SYNC_BATCH_SIZE = 50;

class PullPushSync<T extends SyncableEntity> {
  constructor(
    private readonly localDb: LocalTable<T>,
    private readonly apiEndpoint: string,
    private readonly conflictResolver: ConflictResolver<T>,
  ) {}

  async sync(): Promise<SyncResult> {
    const result: SyncResult = {
      uploaded: 0,
      downloaded: 0,
      conflicts: 0,
      errors: [],
    };

    try {
      const serverChanges = await this.pull();
      result.downloaded = serverChanges.length;

      result.conflicts = (await this.merge(serverChanges)).length;
      result.uploaded = await this.push();
    } catch (error) {
      result.errors.push(
        error instanceof Error ? error.message : "Unknown error",
      );
    }

    return result;
  }

  private async pull(): Promise<T[]> {
    const lastSync = await this.getLastSyncTimestamp();

    const response = await fetch(
      `${this.apiEndpoint}/changes?since=${lastSync}`,
    );
    if (!response.ok) throw new Error(`Pull failed: ${response.status}`);

    const data = await response.json();
    return data.items as T[];
  }

  private async merge(serverItems: T[]): Promise<T[]> {
    const conflicts: T[] = [];

    for (const serverItem of serverItems) {
      const localItem = await this.localDb.get(serverItem.id);

      // no local copy, or no local edits: the server's copy is simply newer
      if (!localItem || localItem._syncStatus === "synced") {
        await this.localDb.put({ ...serverItem, _syncStatus: "synced" });
        continue;
      }

      // local edits exist; a moved server version means both sides changed
      if (serverItem._serverVersion === localItem._serverVersion) continue;

      const resolved = await this.conflictResolver.resolve(
        localItem,
        serverItem,
      );

      if (resolved) {
        await this.localDb.put(resolved);
      } else {
        await this.localDb.put({ ...localItem, _syncStatus: "conflicted" });
        conflicts.push(localItem);
      }
    }

    return conflicts;
  }

  private async push(): Promise<number> {
    const pendingItems = await this.localDb.getByStatus("pending");
    let uploaded = 0;

    for (let i = 0; i < pendingItems.length; i += SYNC_BATCH_SIZE) {
      const batch = pendingItems.slice(i, i + SYNC_BATCH_SIZE);

      const response = await fetch(`${this.apiEndpoint}/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: batch }),
      });

      if (!response.ok) throw new Error(`Push failed: ${response.status}`);

      const result = await response.json();

      for (const item of result.items) {
        await this.localDb.put({ ...item, _syncStatus: "synced" });
        uploaded++;
      }
    }

    return uploaded;
  }

  private async getLastSyncTimestamp(): Promise<number> {
    const stored = localStorage.getItem(`lastSync:${this.apiEndpoint}`);
    return stored ? parseInt(stored, 10) : 0;
  }
}

export { PullPushSync };
export type { SyncResult };
```

---

## Pattern 24: Sync status indicators

Two levels: a per-record marker and an app-wide summary. Both are `role="status"` so a change is
announced rather than only drawn.

```tsx
// components/sync-status-indicator.tsx
type EntitySyncStatus = "synced" | "pending" | "conflicted" | "error";

interface EntitySyncIndicatorProps {
  status: EntitySyncStatus;
  lastSynced?: number;
  size?: "sm" | "md";
}

function EntitySyncIndicator({
  status,
  lastSynced,
  size = "sm",
}: EntitySyncIndicatorProps) {
  const labels: Record<EntitySyncStatus, string> = {
    synced: "Synced",
    pending: "Saving...",
    conflicted: "Conflict detected",
    error: "Sync failed",
  };

  const icons: Record<EntitySyncStatus, string> = {
    synced: "✓",
    pending: "↻",
    conflicted: "⚠",
    error: "✕",
  };

  return (
    <span
      role="status"
      aria-label={labels[status]}
      data-sync-status={status}
      data-size={size}
      title={
        lastSynced
          ? `Last synced: ${new Date(lastSynced).toLocaleString()}`
          : undefined
      }
    >
      <span aria-hidden="true">{icons[status]}</span>
    </span>
  );
}

interface AppSyncStatusProps {
  isOnline: boolean;
  pendingCount: number;
  lastSyncTime: number | null;
  onForceSync?: () => void;
  isSyncing?: boolean;
}

function AppSyncStatus({
  isOnline,
  pendingCount,
  lastSyncTime,
  onForceSync,
  isSyncing = false,
}: AppSyncStatusProps) {
  const canSyncNow = isOnline && pendingCount > 0 && !isSyncing && onForceSync;

  return (
    <div role="status" aria-live="polite">
      {!isOnline ? (
        <span data-status="offline">
          <span aria-hidden="true">●</span>
          Offline — changes saved locally
        </span>
      ) : pendingCount > 0 ? (
        <span data-status="syncing">
          <span aria-hidden="true">↻</span>
          {isSyncing ? "Syncing..." : `${pendingCount} changes pending`}
        </span>
      ) : (
        <span data-status="synced">
          <span aria-hidden="true">✓</span>
          All changes synced
          {lastSyncTime && (
            <time dateTime={new Date(lastSyncTime).toISOString()}>
              {formatRelativeTime(lastSyncTime)}
            </time>
          )}
        </span>
      )}

      {canSyncNow && (
        <button type="button" onClick={onForceSync} aria-label="Sync now">
          Sync now
        </button>
      )}
    </div>
  );
}

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;

function formatRelativeTime(timestamp: number): string {
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const diff = timestamp - Date.now();

  if (Math.abs(diff / MS_PER_MINUTE) < MINUTES_PER_HOUR) {
    return rtf.format(Math.round(diff / MS_PER_MINUTE), "minute");
  }
  if (Math.abs(diff / MS_PER_HOUR) < HOURS_PER_DAY) {
    return rtf.format(Math.round(diff / MS_PER_HOUR), "hour");
  }
  return rtf.format(Math.round(diff / MS_PER_DAY), "day");
}

export { EntitySyncIndicator, AppSyncStatus };
export type { EntitySyncStatus, EntitySyncIndicatorProps, AppSyncStatusProps };
```

Wording matters more than the icons: "saved locally" tells the user their work is safe, where
"offline" only tells them something is wrong.

# Offline-First — IndexedDB Examples

> Schema, migrations, the two wrapper choices, and the operational concerns of a browser database.
> Decisions are in [SKILL.md](../SKILL.md); [core.md](core.md) has the write path that sits on top.

---

## Pattern 11: Dexie schema

Declare each version's indexes; Dexie replays them in order for a database opened at any earlier
version. Index every field a query filters or sorts on — `_syncStatus` and `_deletedAt` especially,
since the queue and every read touch them.

```typescript
// db/database.ts
import Dexie, { type Table } from "dexie";

interface SyncMetadata {
  _syncStatus: "synced" | "pending" | "conflicted";
  _lastModified: number;
  _localVersion: string;
  _serverVersion?: string;
  _deletedAt?: number;
}

interface Todo extends SyncMetadata {
  id: string;
  title: string;
  completed: boolean;
  userId: string;
  createdAt: number;
}

interface User extends SyncMetadata {
  id: string;
  email: string;
  name: string;
  preferences: { theme: "light" | "dark" | "system"; notifications: boolean };
}

interface QueuedOperation {
  id: string;
  type: "CREATE" | "UPDATE" | "DELETE" | "UPSERT";
  collection: string;
  data: unknown;
  timestamp: number;
  retryCount: number;
  lastError?: string;
}

const CURRENT_DB_VERSION = 3;

class AppDatabase extends Dexie {
  todos!: Table<Todo, string>;
  users!: Table<User, string>;
  syncQueue!: Table<QueuedOperation, string>;

  constructor() {
    super("myapp-db");

    this.version(1).stores({
      todos: "id, userId, _syncStatus, _lastModified",
      users: "id, email, _syncStatus",
      syncQueue: "id, collection, timestamp",
    });

    this.version(2).stores({
      todos: "id, userId, _syncStatus, _lastModified, [userId+completed]",
      users: "id, email, _syncStatus",
      syncQueue: "id, collection, timestamp, retryCount",
    });

    this.version(CURRENT_DB_VERSION).stores({
      todos:
        "id, userId, _syncStatus, _lastModified, _deletedAt, [userId+completed]",
      users: "id, email, _syncStatus, _deletedAt",
      syncQueue: "id, collection, timestamp, retryCount",
    });
  }

  /** Force a full re-upload — for a server reset or a corrupted sync state. */
  async clearSyncState(): Promise<void> {
    await this.transaction("rw", [this.todos, this.users], async () => {
      await this.todos
        .toCollection()
        .modify({ _syncStatus: "pending", _serverVersion: undefined });
      await this.users
        .toCollection()
        .modify({ _syncStatus: "pending", _serverVersion: undefined });
    });
  }

  /** Delete tombstones the server has already acknowledged. */
  async cleanupTombstones(
    retentionMs: number = 30 * 24 * 60 * 60 * 1000,
  ): Promise<number> {
    const threshold = Date.now() - retentionMs;
    let deletedCount = 0;

    await this.transaction("rw", [this.todos, this.users], async () => {
      deletedCount += await this.todos
        .where("_deletedAt")
        .below(threshold)
        .and((item) => item._syncStatus === "synced")
        .delete();

      deletedCount += await this.users
        .where("_deletedAt")
        .below(threshold)
        .and((item) => item._syncStatus === "synced")
        .delete();
    });

    return deletedCount;
  }
}

const db = new AppDatabase();

async function initDatabase(): Promise<AppDatabase> {
  await db.open();
  return db;
}

export { db, initDatabase, AppDatabase };
export type { Todo, User, QueuedOperation, SyncMetadata };
```

The tombstone sweep only touches records whose `_syncStatus` is `synced`. Deleting an unsynced
tombstone loses the deletion.

---

## Pattern 12: Reads and writes with Dexie

Reads go through `useLiveQuery` and re-run whenever the underlying rows change, including changes
made by the sync queue. Mutations are plain functions — they need no hook, and calling them from an
event handler keeps the component simple.

```typescript
// hooks/use-todos.ts
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/database";
import type { Todo } from "../db/database";

const SYNC_STATUS = {
  SYNCED: "synced",
  PENDING: "pending",
  CONFLICTED: "conflicted",
} as const;

function useTodos(userId: string) {
  const todos = useLiveQuery(
    () =>
      db.todos
        .where("userId")
        .equals(userId)
        .and((todo) => !todo._deletedAt)
        .reverse()
        .sortBy("_lastModified"),
    [userId],
  );

  return { data: todos ?? [], isLoading: todos === undefined };
}

function useTodo(id: string | undefined) {
  return useLiveQuery(async () => {
    if (!id) return null;
    const todo = await db.todos.get(id);
    return todo?._deletedAt ? null : (todo ?? null);
  }, [id]);
}

async function createTodo(title: string, userId: string): Promise<Todo> {
  const now = Date.now();
  const todo: Todo = {
    id: crypto.randomUUID(),
    title,
    completed: false,
    userId,
    createdAt: now,
    _syncStatus: SYNC_STATUS.PENDING,
    _lastModified: now,
    _localVersion: crypto.randomUUID(),
  };

  await db.todos.add(todo);
  return todo;
}

async function updateTodo(
  id: string,
  updates: Partial<Pick<Todo, "title" | "completed">>,
): Promise<void> {
  await db.todos.update(id, {
    ...updates,
    _syncStatus: SYNC_STATUS.PENDING,
    _lastModified: Date.now(),
    _localVersion: crypto.randomUUID(),
  });
}

async function deleteTodo(id: string): Promise<void> {
  await db.todos.update(id, {
    _deletedAt: Date.now(),
    _syncStatus: SYNC_STATUS.PENDING,
    _lastModified: Date.now(),
    _localVersion: crypto.randomUUID(),
  });
}

async function markTodosComplete(ids: string[]): Promise<void> {
  await db.transaction("rw", db.todos, async () => {
    for (const id of ids) {
      await updateTodo(id, { completed: true });
    }
  });
}

async function clearCompletedTodos(userId: string): Promise<void> {
  // booleans are not indexable; the compound index stores 1 and 0
  const completed = await db.todos
    .where("[userId+completed]")
    .equals([userId, 1])
    .toArray();

  await db.transaction("rw", db.todos, async () => {
    for (const todo of completed) {
      await deleteTodo(todo.id);
    }
  });
}

export {
  useTodos,
  useTodo,
  createTodo,
  updateTodo,
  deleteTodo,
  markTodosComplete,
  clearCompletedTodos,
};
```

---

## Pattern 13: The idb alternative

A thin promise wrapper — its own README puts it at ~1.19 kB brotli'd, a fraction of Dexie — with the
schema expressed as a type rather than as an index string. No live queries, so pair it with
[core.md](core.md) Pattern 10.

Its `upgrade` callback runs inside a version-change transaction, so keep every `await` in it against
the database. An awaited `fetch` there closes the transaction mid-migration.

```typescript
// db/idb-database.ts
import { openDB, type DBSchema, type IDBPDatabase } from "idb";

interface AppDBSchema extends DBSchema {
  todos: {
    key: string;
    value: {
      id: string;
      title: string;
      completed: boolean;
      userId: string;
      createdAt: number;
      _syncStatus: "synced" | "pending" | "conflicted";
      _lastModified: number;
      _localVersion: string;
      _serverVersion?: string;
      _deletedAt?: number;
    };
    indexes: {
      "by-user": string;
      "by-sync-status": string;
      "by-deleted": number;
    };
  };
  syncQueue: {
    key: string;
    value: {
      id: string;
      type: "CREATE" | "UPDATE" | "DELETE";
      collection: string;
      data: unknown;
      timestamp: number;
      retryCount: number;
    };
    indexes: { "by-timestamp": number };
  };
}

const DB_NAME = "myapp-idb";
const DB_VERSION = 1;

async function initIdbDatabase(): Promise<IDBPDatabase<AppDBSchema>> {
  return openDB<AppDBSchema>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        const todos = db.createObjectStore("todos", { keyPath: "id" });
        todos.createIndex("by-user", "userId");
        todos.createIndex("by-sync-status", "_syncStatus");
        todos.createIndex("by-deleted", "_deletedAt");

        const syncQueue = db.createObjectStore("syncQueue", { keyPath: "id" });
        syncQueue.createIndex("by-timestamp", "timestamp");
      }
    },
    blocked() {
      // another tab holds an older connection open
      console.warn("Database upgrade blocked by other tabs");
    },
    blocking() {
      // this tab is holding up another tab's upgrade
      console.warn("Blocking other tabs from upgrade");
    },
  });
}

type TodoRecord = AppDBSchema["todos"]["value"];

class IdbTodoRepository {
  constructor(private db: IDBPDatabase<AppDBSchema>) {}

  async getAll(userId: string): Promise<TodoRecord[]> {
    const todos = await this.db.getAllFromIndex("todos", "by-user", userId);
    return todos.filter((todo) => !todo._deletedAt);
  }

  async get(id: string): Promise<TodoRecord | null> {
    const todo = await this.db.get("todos", id);
    if (todo?._deletedAt) return null;
    return todo ?? null;
  }

  async save(todo: TodoRecord): Promise<void> {
    await this.db.put("todos", {
      ...todo,
      _syncStatus: "pending",
      _lastModified: Date.now(),
      _localVersion: crypto.randomUUID(),
    });
  }

  async delete(id: string): Promise<void> {
    const existing = await this.db.get("todos", id);
    if (!existing) return;

    await this.db.put("todos", {
      ...existing,
      _deletedAt: Date.now(),
      _syncStatus: "pending",
      _lastModified: Date.now(),
      _localVersion: crypto.randomUUID(),
    });
  }

  async getPending(): Promise<TodoRecord[]> {
    return this.db.getAllFromIndex("todos", "by-sync-status", "pending");
  }

  async markSynced(id: string, serverVersion: string): Promise<void> {
    const todo = await this.db.get("todos", id);
    if (!todo) return;

    await this.db.put("todos", {
      ...todo,
      _syncStatus: "synced",
      _serverVersion: serverVersion,
    });
  }
}

export { initIdbDatabase, IdbTodoRepository };
export type { AppDBSchema, TodoRecord };
```

For plain key-value storage with no schema, a key-value wrapper over IndexedDB is smaller again.

---

## Pattern 14: Migration with a data transform

A schema change that leaves existing rows invalid needs an `upgrade` alongside the new indexes.
Check before writing, so re-running the migration is harmless.

```typescript
// db/migrations.ts
import { db } from "./database";

const MIGRATION_VERSIONS = {
  INITIAL: 1,
  ADD_SYNC_METADATA: 2,
  NORMALIZE_TIMESTAMPS: 3,
} as const;

db.version(MIGRATION_VERSIONS.INITIAL).stores({
  todos: "id, userId",
});

db.version(MIGRATION_VERSIONS.ADD_SYNC_METADATA)
  .stores({
    todos: "id, userId, _syncStatus, _lastModified",
  })
  .upgrade(async (tx) => {
    await tx
      .table("todos")
      .toCollection()
      .modify((todo) => {
        if (todo._syncStatus) return;
        // rows that predate sync came from the server, so they are synced
        todo._syncStatus = "synced";
        todo._lastModified = Date.now();
        todo._localVersion = crypto.randomUUID();
      });
  });

db.version(MIGRATION_VERSIONS.NORMALIZE_TIMESTAMPS)
  .stores({
    todos: "id, userId, _syncStatus, _lastModified, createdAt",
  })
  .upgrade(async (tx) => {
    await tx
      .table("todos")
      .toCollection()
      .modify((todo) => {
        if (typeof todo.createdAt === "string") {
          todo.createdAt = new Date(todo.createdAt).getTime();
        }
        if (typeof todo._lastModified === "string") {
          todo._lastModified = new Date(todo._lastModified).getTime();
        }
      });
  });

export { MIGRATION_VERSIONS };
```

An ISO string sorts as text and cannot be range-queried as a number, which is why the third
migration exists at all — indexing a mixed-type field silently returns wrong results.

---

## Pattern 15: Multi-tab coordination

Two tabs share one database and neither knows what the other is doing. `BroadcastChannel` gives
them a cooperative lock for operations that must not overlap — a sync run above all — and a way to
tell each other that the data changed.

```typescript
// db/tab-coordinator.ts
const HEARTBEAT_INTERVAL_MS = 5000;
const STALE_LOCK_THRESHOLD_MS = 10_000;

interface TabLock {
  tabId: string;
  timestamp: number;
  operation: string;
}

class TabCoordinator {
  private readonly tabId = crypto.randomUUID();
  private readonly channel = new BroadcastChannel("app-tab-coordinator");
  private activeLocks = new Map<string, TabLock>();
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.setupListeners();
    this.startHeartbeat();
  }

  private setupListeners(): void {
    this.channel.onmessage = (event) => {
      const { type, payload } = event.data;

      switch (type) {
        case "LOCK_ACQUIRED":
          this.activeLocks.set(payload.operation, payload);
          break;

        case "LOCK_RELEASED":
          this.activeLocks.delete(payload.operation);
          break;

        case "HEARTBEAT":
          if (
            this.activeLocks.get(payload.operation)?.tabId === payload.tabId
          ) {
            this.activeLocks.set(payload.operation, payload);
          }
          break;

        case "DB_CHANGED":
          window.dispatchEvent(
            new CustomEvent("database-changed", { detail: payload }),
          );
          break;
      }
    };
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      for (const [, lock] of this.activeLocks) {
        if (lock.tabId !== this.tabId) continue;
        this.channel.postMessage({
          type: "HEARTBEAT",
          payload: { ...lock, timestamp: Date.now() },
        });
      }

      this.cleanupStaleLocks();
    }, HEARTBEAT_INTERVAL_MS);
  }

  /** A tab that closes mid-operation stops heartbeating; its lock expires. */
  private cleanupStaleLocks(): void {
    const now = Date.now();

    for (const [operation, lock] of this.activeLocks) {
      if (now - lock.timestamp > STALE_LOCK_THRESHOLD_MS) {
        this.activeLocks.delete(operation);
      }
    }
  }

  async acquireLock(operation: string): Promise<boolean> {
    const existingLock = this.activeLocks.get(operation);

    const heldElsewhere =
      existingLock &&
      Date.now() - existingLock.timestamp < STALE_LOCK_THRESHOLD_MS;
    if (heldElsewhere) return false;

    const lock: TabLock = {
      tabId: this.tabId,
      timestamp: Date.now(),
      operation,
    };

    this.activeLocks.set(operation, lock);
    this.channel.postMessage({ type: "LOCK_ACQUIRED", payload: lock });

    return true;
  }

  releaseLock(operation: string): void {
    const lock = this.activeLocks.get(operation);
    if (lock?.tabId !== this.tabId) return;

    this.activeLocks.delete(operation);
    this.channel.postMessage({
      type: "LOCK_RELEASED",
      payload: { operation },
    });
  }

  notifyDatabaseChange(collection: string, id: string): void {
    this.channel.postMessage({
      type: "DB_CHANGED",
      payload: { collection, id, tabId: this.tabId },
    });
  }

  destroy(): void {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);

    for (const [operation, lock] of this.activeLocks) {
      if (lock.tabId === this.tabId) this.releaseLock(operation);
    }

    this.channel.close();
  }
}

const tabCoordinator = new TabCoordinator();

export { tabCoordinator, TabCoordinator };
export type { TabLock };
```

This is advisory rather than enforced: a tab that ignores the lock still writes. It works because
every tab runs the same code.

---

## Pattern 16: Quota management

Storage is best-effort until you ask otherwise. Watch usage, ask for persistence, and know what to
evict first.

```typescript
// db/storage-manager.ts
const STORAGE_WARNING_THRESHOLD = 0.8;
const STORAGE_CRITICAL_THRESHOLD = 0.95;

interface StorageInfo {
  usedBytes: number;
  totalBytes: number;
  percentUsed: number;
  status: "ok" | "warning" | "critical";
}

async function getStorageInfo(): Promise<StorageInfo> {
  // absent outside a secure context, and on browsers without StorageManager
  if (!navigator.storage?.estimate) {
    return { usedBytes: 0, totalBytes: 0, percentUsed: 0, status: "ok" };
  }

  const estimate = await navigator.storage.estimate();
  const used = estimate.usage ?? 0;
  const total = estimate.quota ?? 0;
  const percentUsed = total > 0 ? used / total : 0;

  const status: StorageInfo["status"] =
    percentUsed >= STORAGE_CRITICAL_THRESHOLD
      ? "critical"
      : percentUsed >= STORAGE_WARNING_THRESHOLD
        ? "warning"
        : "ok";

  return { usedBytes: used, totalBytes: total, percentUsed, status };
}

/** Ask the browser to exempt this origin from best-effort eviction. */
async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}

interface CleanupResult {
  freedBytes: number;
  itemsRemoved: number;
}

async function performStorageCleanup(
  db: LocalDatabase,
): Promise<CleanupResult> {
  const TOMBSTONE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
  const threshold = Date.now() - TOMBSTONE_AGE_MS;

  let freedBytes = 0;
  let itemsRemoved = 0;

  const tombstones = await db.todos
    .where("_deletedAt")
    .below(threshold)
    .and((item) => item._syncStatus === "synced")
    .toArray();

  for (const item of tombstones) {
    await db.todos.delete(item.id);
    itemsRemoved++;
    freedBytes += new Blob([JSON.stringify(item)]).size;
  }

  return { freedBytes, itemsRemoved };
}

export { getStorageInfo, requestPersistentStorage, performStorageCleanup };
export type { StorageInfo, CleanupResult };
```

The freed-bytes figure is an estimate from the serialised size; IndexedDB's real on-disk cost
includes indexes and is not exposed per record.

Ask for persistence after the user has done something that shows intent — saved a first record, or
installed the app — rather than on first load. Browsers weigh engagement when deciding.

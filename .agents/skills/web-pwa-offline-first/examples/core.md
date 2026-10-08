# Offline-First — Core Examples

> The local-first write path end to end. Decisions are in [SKILL.md](../SKILL.md);
> [indexeddb.md](indexeddb.md) covers the store itself and [sync.md](sync.md) covers reconciliation.

---

## Pattern 1: Syncable entity

Sync metadata is prefixed so a merge can skip the whole set with one check, and a factory keeps
creation consistent.

```typescript
interface SyncableEntity {
  id: string;
  _syncStatus: "synced" | "pending" | "conflicted";
  _lastModified: number; // client clock
  _serverTimestamp?: number; // server clock, preferred when present
  _localVersion: string; // new UUID on every local write
  _serverVersion?: string; // the version the server last confirmed
  _deletedAt?: number; // tombstone
}

const SYNC_STATUS = {
  SYNCED: "synced",
  PENDING: "pending",
  CONFLICTED: "conflicted",
} as const;

interface Todo extends SyncableEntity {
  title: string;
  completed: boolean;
  userId: string;
}

function createTodo(title: string, userId: string): Todo {
  return {
    id: crypto.randomUUID(),
    title,
    completed: false,
    userId,
    _syncStatus: SYNC_STATUS.PENDING,
    _lastModified: Date.now(),
    _localVersion: crypto.randomUUID(),
  };
}
```

The IDs are client-generated. Waiting for the server to assign one means a record created offline
has no identity until it syncs, which breaks every reference to it in the meantime.

---

## Pattern 2: Repository

The one place that knows a write is a local `put` plus an enqueue. Reads filter tombstones so no
caller has to remember they exist.

```typescript
import type { Table } from "dexie";

interface DataRepository<T extends SyncableEntity> {
  get(id: string): Promise<T | null>;
  getAll(): Promise<T[]>;
  query(filter: (item: T) => boolean): Promise<T[]>;
  save(item: T): Promise<void>;
  delete(id: string): Promise<void>;
  getSyncStatus(id: string): Promise<SyncStatus>;
  getPendingCount(): Promise<number>;
}

type SyncStatus = "synced" | "pending" | "conflicted" | "error";

class TodoRepository implements DataRepository<Todo> {
  constructor(
    private readonly localDb: Table<Todo, string>,
    private readonly syncQueue: SyncQueue,
  ) {}

  async get(id: string): Promise<Todo | null> {
    const todo = await this.localDb.get(id);
    if (todo?._deletedAt) return null;
    return todo ?? null;
  }

  async getAll(): Promise<Todo[]> {
    return this.localDb.filter((todo) => !todo._deletedAt).toArray();
  }

  async save(todo: Todo): Promise<void> {
    const now = Date.now();

    const updatedTodo: Todo = {
      ...todo,
      _syncStatus: SYNC_STATUS.PENDING,
      _lastModified: now,
      _localVersion: crypto.randomUUID(),
    };

    await this.localDb.put(updatedTodo);

    await this.syncQueue.enqueue({
      type: "UPSERT",
      collection: "todos",
      data: updatedTodo,
      timestamp: now,
    });
  }

  async delete(id: string): Promise<void> {
    const now = Date.now();

    await this.localDb.update(id, {
      _syncStatus: SYNC_STATUS.PENDING,
      _lastModified: now,
      _deletedAt: now,
    });

    await this.syncQueue.enqueue({
      type: "DELETE",
      collection: "todos",
      data: { id },
      timestamp: now,
    });
  }

  async getSyncStatus(id: string): Promise<SyncStatus> {
    const todo = await this.localDb.get(id);
    return todo?._syncStatus ?? "error";
  }

  async getPendingCount(): Promise<number> {
    return this.localDb
      .where("_syncStatus")
      .equals(SYNC_STATUS.PENDING)
      .count();
  }
}

export { TodoRepository };
export type { DataRepository, SyncStatus };
```

---

## Pattern 3: Sync queue

Operations are drained in timestamp order so a create is never replayed after the update that
followed it. A failure increments the attempt count and reschedules; exceeding the ceiling emits an
event rather than retrying forever.

```typescript
interface QueuedOperation {
  id: string;
  type: "CREATE" | "UPDATE" | "DELETE" | "UPSERT";
  collection: string;
  data: unknown;
  timestamp: number;
  retryCount: number;
  lastError?: string;
}

const MAX_RETRY_ATTEMPTS = 5;
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;
const BACKOFF_MULTIPLIER = 2;
const JITTER_FACTOR = 0.5;

function calculateBackoff(attempt: number): number {
  const exponentialDelay = Math.min(
    INITIAL_BACKOFF_MS * Math.pow(BACKOFF_MULTIPLIER, attempt),
    MAX_BACKOFF_MS,
  );

  // jitter spreads reconnecting clients out instead of synchronising them
  const jitter = exponentialDelay * JITTER_FACTOR * (Math.random() * 2 - 1);

  return Math.floor(exponentialDelay + jitter);
}

class SyncQueue {
  private readonly db: LocalDatabase;
  private readonly STORE_NAME = "syncQueue";
  private processing = false;
  private listeners = new Set<() => void>();

  constructor(db: LocalDatabase) {
    this.db = db;

    if (typeof window !== "undefined") {
      window.addEventListener("online", () => this.processQueue());
    }
  }

  /** Fires when the queue changes, so a view can re-read the count. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach((listener) => listener());
  }

  async enqueue(
    operation: Omit<QueuedOperation, "id" | "retryCount">,
  ): Promise<void> {
    await this.db.add(this.STORE_NAME, {
      ...operation,
      id: crypto.randomUUID(),
      retryCount: 0,
    });
    this.notify();

    if (navigator.onLine) this.processQueue();
  }

  async processQueue(): Promise<void> {
    if (this.processing || !navigator.onLine) return;
    this.processing = true;

    try {
      const operations = await this.db.getAll(this.STORE_NAME);
      operations.sort((a, b) => a.timestamp - b.timestamp);

      for (const op of operations) {
        try {
          await this.executeOperation(op);
          await this.db.delete(this.STORE_NAME, op.id);
        } catch (error) {
          await this.handleOperationError(op, error);
        }
      }
    } finally {
      this.processing = false;
      this.notify();
    }
  }

  private async executeOperation(op: QueuedOperation): Promise<void> {
    const response = await fetch(`/api/${op.collection}`, {
      method: this.getHttpMethod(op.type),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(op.data),
    });

    if (!response.ok) {
      throw new Error(`Sync failed: ${response.status}`);
    }
  }

  private getHttpMethod(type: QueuedOperation["type"]): string {
    const methods: Record<QueuedOperation["type"], string> = {
      CREATE: "POST",
      UPDATE: "PUT",
      DELETE: "DELETE",
      UPSERT: "PUT",
    };
    return methods[type];
  }

  private async handleOperationError(
    op: QueuedOperation,
    error: unknown,
  ): Promise<void> {
    if (op.retryCount >= MAX_RETRY_ATTEMPTS) {
      await this.db.delete(this.STORE_NAME, op.id);
      this.emitSyncFailure(op);
      return;
    }

    await this.db.put(this.STORE_NAME, {
      ...op,
      retryCount: op.retryCount + 1,
      lastError: error instanceof Error ? error.message : "Unknown error",
    });

    setTimeout(() => this.processQueue(), calculateBackoff(op.retryCount));
  }

  private emitSyncFailure(op: QueuedOperation): void {
    window.dispatchEvent(new CustomEvent("sync-failure", { detail: op }));
  }

  async getQueueLength(): Promise<number> {
    const operations = await this.db.getAll(this.STORE_NAME);
    return operations.length;
  }
}

export { SyncQueue };
export type { QueuedOperation };
```

A dropped operation is a lost write, so `emitSyncFailure` has to reach the user. Silently deleting
it is the worst of both.

---

## Pattern 4: Network status

One manager, framework-agnostic, that combines the browser flag with a real request and reports a
third state for a connection that is technically up and unusably slow.

```typescript
type NetworkStatus = "online" | "offline" | "slow";
type NetworkListener = (status: NetworkStatus) => void;

const SLOW_THRESHOLD_MS = 2000;
const HEALTH_CHECK_INTERVAL_MS = 30_000;

class NetworkStatusManager {
  private status: NetworkStatus = navigator.onLine ? "online" : "offline";
  private listeners = new Set<NetworkListener>();
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    window.addEventListener("online", () => {
      this.updateStatus("online");
      this.checkConnectionQuality();
    });

    window.addEventListener("offline", () => {
      this.updateStatus("offline");
      this.stopHealthCheck();
    });

    if (navigator.onLine) this.checkConnectionQuality();
  }

  private updateStatus(newStatus: NetworkStatus): void {
    if (this.status === newStatus) return;
    this.status = newStatus;
    this.listeners.forEach((listener) => listener(newStatus));
  }

  getStatus(): NetworkStatus {
    return this.status;
  }

  subscribe(listener: NetworkListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async checkConnectionQuality(): Promise<NetworkStatus> {
    if (!navigator.onLine) {
      this.updateStatus("offline");
      return "offline";
    }

    try {
      const start = performance.now();
      const response = await fetch("/api/health", {
        method: "HEAD",
        cache: "no-store",
      });
      const latency = performance.now() - start;

      if (!response.ok) {
        this.updateStatus("offline");
        return "offline";
      }

      const status = latency > SLOW_THRESHOLD_MS ? "slow" : "online";
      this.updateStatus(status);
      return status;
    } catch {
      this.updateStatus("offline");
      return "offline";
    }
  }

  startHealthCheck(): void {
    this.stopHealthCheck();
    this.healthCheckInterval = setInterval(
      () => this.checkConnectionQuality(),
      HEALTH_CHECK_INTERVAL_MS,
    );
  }

  private stopHealthCheck(): void {
    if (!this.healthCheckInterval) return;
    clearInterval(this.healthCheckInterval);
    this.healthCheckInterval = null;
  }

  destroy(): void {
    this.stopHealthCheck();
    this.listeners.clear();
  }
}

const networkStatus = new NetworkStatusManager();

export { networkStatus, NetworkStatusManager };
export type { NetworkStatus, NetworkListener };
```

---

## Pattern 5: Optimistic updates with rollback

The rollback closure captures the previous value, so the caller's error path is a single call and
cannot reconstruct the wrong state.

```typescript
interface PendingChange<T> {
  id: string;
  previousValue: T | null;
  newValue: T;
  timestamp: number;
}

interface LocalStore<T> {
  get: (id: string) => Promise<T | undefined>;
  put: (value: T) => Promise<void>;
  delete: (id: string) => Promise<void>;
}

class OptimisticUpdateManager<T extends SyncableEntity> {
  private pendingChanges = new Map<string, PendingChange<T>>();

  async applyOptimistically(
    id: string,
    newValue: T,
    localDb: LocalStore<T>,
    onUpdate: (items: T[]) => void,
    getAllItems: () => Promise<T[]>,
  ): Promise<() => Promise<void>> {
    const previousValue = (await localDb.get(id)) ?? null;

    this.pendingChanges.set(id, {
      id,
      previousValue,
      newValue,
      timestamp: Date.now(),
    });

    await localDb.put(newValue);
    onUpdate(await getAllItems());

    return async () => {
      const pending = this.pendingChanges.get(id);
      if (!pending) return;

      // a null previous value means the record did not exist — undo is a delete
      if (pending.previousValue) await localDb.put(pending.previousValue);
      else await localDb.delete(id);

      this.pendingChanges.delete(id);
      onUpdate(await getAllItems());
    };
  }

  async confirmChange(id: string): Promise<void> {
    this.pendingChanges.delete(id);
  }

  hasPendingChanges(): boolean {
    return this.pendingChanges.size > 0;
  }

  getPendingChangeIds(): string[] {
    return Array.from(this.pendingChanges.keys());
  }
}

export { OptimisticUpdateManager };
export type { PendingChange };
```

---

## Pattern 6: Connection-aware fetching

Returns the provenance with the payload, so a screen can say where its data came from.

```typescript
const FETCH_TIMEOUT_MS = 10_000;

interface FetchResult<T> {
  data: T;
  source: "network" | "cache";
  timestamp: number;
}

interface LocalCache {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, timestamp?: number): Promise<void>;
}

async function fetchWithOfflineSupport<T>(
  url: string,
  localCache: LocalCache,
  options: RequestInit = {},
): Promise<FetchResult<T>> {
  const cacheKey = `fetch:${url}`;
  type Cached = { data: T; timestamp: number };

  if (!navigator.onLine) {
    const cached = await localCache.get<Cached>(cacheKey);
    if (cached) {
      return {
        data: cached.data,
        source: "cache",
        timestamp: cached.timestamp,
      };
    }
    throw new Error("Offline and no cached data available");
  }

  try {
    const response = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = (await response.json()) as T;
    const timestamp = Date.now();
    await localCache.set(cacheKey, { data, timestamp });

    return { data, source: "network", timestamp };
  } catch (error) {
    // a timeout or an unreachable host is still worth answering from cache
    const cached = await localCache.get<Cached>(cacheKey);
    if (cached) {
      console.warn("Network failed, using cached data:", error);
      return {
        data: cached.data,
        source: "cache",
        timestamp: cached.timestamp,
      };
    }
    throw error;
  }
}

export { fetchWithOfflineSupport };
export type { FetchResult, LocalCache };
```

---

## Pattern 7: Subscribing a component to network status

`useSyncExternalStore` binds the manager from Pattern 4 without duplicating its logic, and its
server snapshot keeps a server render from touching `navigator`.

```typescript
// hooks/use-network-status.ts
import { useCallback, useSyncExternalStore } from "react";
import { networkStatus, type NetworkStatus } from "../sync/network-status";

function useNetworkStatus(): NetworkStatus {
  const subscribe = useCallback(
    (callback: () => void) => networkStatus.subscribe(callback),
    [],
  );
  const getSnapshot = useCallback(() => networkStatus.getStatus(), []);
  const getServerSnapshot = useCallback(() => "online" as NetworkStatus, []);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export { useNetworkStatus };
```

Rendering it: see [sync.md](sync.md) Pattern 24 for the status indicators.

---

## Pattern 8: Offline-aware mutation

Separates the local write from the enqueue, and reports `isPending` for a change that saved locally
but has not reached the server — the state the user most needs to see.

```typescript
// hooks/use-offline-mutation.ts
import { useCallback, useState } from "react";

interface MutationState<T> {
  data: T | null;
  isLoading: boolean;
  isSuccess: boolean;
  isError: boolean;
  error: Error | null;
  isPending: boolean; // saved locally, not yet synced
}

interface MutationOptions<TInput, TOutput> {
  localMutation: (input: TInput) => Promise<TOutput>;
  queueSync: (input: TInput) => Promise<void>;
  onOptimisticUpdate?: (input: TInput) => void;
  onRollback?: (input: TInput, error: Error) => void;
}

const IDLE: MutationState<never> = {
  data: null,
  isLoading: false,
  isSuccess: false,
  isError: false,
  error: null,
  isPending: false,
};

function useOfflineMutation<TInput, TOutput>(
  options: MutationOptions<TInput, TOutput>,
) {
  const [state, setState] = useState<MutationState<TOutput>>(IDLE);

  const mutate = useCallback(
    async (input: TInput) => {
      setState((prev) => ({
        ...prev,
        isLoading: true,
        isError: false,
        error: null,
      }));
      options.onOptimisticUpdate?.(input);

      try {
        const result = await options.localMutation(input);
        await options.queueSync(input);

        setState({
          ...IDLE,
          data: result,
          isSuccess: true,
          isPending: !navigator.onLine,
        });

        return result;
      } catch (error) {
        const err = error instanceof Error ? error : new Error("Unknown error");
        options.onRollback?.(input, err);
        setState({ ...IDLE, isError: true, error: err });
        throw error;
      }
    },
    [options],
  );

  const reset = useCallback(() => setState(IDLE), []);

  return { ...state, mutate, reset };
}

export { useOfflineMutation };
export type { MutationState, MutationOptions };
```

Wiring it to a form: the local mutation saves through the repository, the queue sync enqueues, and
the form renders `isPending` as "Saved. Will sync when online."

```tsx
const { mutate, isLoading, isPending, isError, error } = useOfflineMutation<
  { title: string },
  Todo
>({
  localMutation: async ({ title }) => {
    const todo = createTodo(title, currentUserId);
    await todoRepository.save(todo);
    return todo;
  },
  queueSync: async ({ title }) => {
    await syncQueue.enqueue({
      type: "CREATE",
      collection: "todos",
      data: createTodo(title, currentUserId),
      timestamp: Date.now(),
    });
  },
});
```

---

## Pattern 9: Offline data provider

Composes the database, the queue and the status into one context, and exposes a manual sync so a
user who does not trust the automatic one has a button.

```typescript
// context/offline-data-provider.tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { LocalDatabase } from '../db/database';
import type { SyncQueue } from '../sync/sync-queue';
import type { NetworkStatus } from '../hooks/use-network-status';

interface OfflineDataContextValue {
  database: LocalDatabase;
  syncQueue: SyncQueue;
  networkStatus: NetworkStatus;
  isInitialized: boolean;
  pendingCount: number;
  lastSyncTime: number | null;
  forceSync: () => Promise<void>;
}

const OfflineDataContext = createContext<OfflineDataContextValue | null>(null);

interface OfflineDataProviderProps {
  children: ReactNode;
  database: LocalDatabase;
  syncQueue: SyncQueue;
}

function OfflineDataProvider({
  children,
  database,
  syncQueue,
}: OfflineDataProviderProps) {
  const [isInitialized, setIsInitialized] = useState(false);
  const [networkStatus, setNetworkStatus] = useState<NetworkStatus>(
    navigator.onLine ? 'online' : 'offline'
  );
  const [pendingCount, setPendingCount] = useState(0);
  const [lastSyncTime, setLastSyncTime] = useState<number | null>(null);

  useEffect(() => {
    async function initialize() {
      try {
        setIsInitialized(true);
        setPendingCount(await syncQueue.getQueueLength());

        if (navigator.onLine) {
          await syncQueue.processQueue();
          setLastSyncTime(Date.now());
        }
      } catch (error) {
        console.error('Failed to initialize offline data layer:', error);
      }
    }

    initialize();
  }, [database, syncQueue]);

  useEffect(() => {
    function handleOnline() {
      setNetworkStatus('online');
      syncQueue.processQueue().then(() => setLastSyncTime(Date.now()));
    }

    function handleOffline() {
      setNetworkStatus('offline');
    }

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [syncQueue]);

  useEffect(
    () => syncQueue.subscribe(() => {
      syncQueue.getQueueLength().then(setPendingCount);
    }),
    [syncQueue]
  );

  const forceSync = async () => {
    if (!navigator.onLine) throw new Error('Cannot sync while offline');
    await syncQueue.processQueue();
    setLastSyncTime(Date.now());
  };

  const value: OfflineDataContextValue = {
    database,
    syncQueue,
    networkStatus,
    isInitialized,
    pendingCount,
    lastSyncTime,
    forceSync,
  };

  return (
    <OfflineDataContext.Provider value={value}>
      {children}
    </OfflineDataContext.Provider>
  );
}

function useOfflineData(): OfflineDataContextValue {
  const context = useContext(OfflineDataContext);
  if (!context) {
    throw new Error('useOfflineData must be used within OfflineDataProvider');
  }
  return context;
}

export { OfflineDataProvider, useOfflineData };
export type { OfflineDataContextValue };
```

The database and queue are constructed outside and passed in, which keeps the provider testable and
lets the app decide when the database opens.

---

## Pattern 10: Reactive local queries

Where the store offers a live query, use it. Where it does not, this is the shape: fetch once, then
re-fetch on a change notification.

```typescript
// hooks/use-local-query.ts
import { useCallback, useEffect, useState } from "react";

interface QueryResult<T> {
  data: T[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

interface QueryOptions<T> {
  queryFn: () => Promise<T[]>;
  subscribe?: (onUpdate: () => void) => () => void;
}

function useLocalQuery<T>(options: QueryOptions<T>): QueryResult<T> {
  const [data, setData] = useState<T[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      setData(await options.queryFn());
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Query failed"));
    } finally {
      setIsLoading(false);
    }
  }, [options.queryFn]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(
    () => options.subscribe?.(fetchData),
    [options.subscribe, fetchData],
  );

  return { data, isLoading, error, refetch: fetchData };
}

export { useLocalQuery };
export type { QueryResult, QueryOptions };
```

With Dexie the same query is one call, and `undefined` is the loading state:

```typescript
import { useLiveQuery } from "dexie-react-hooks";

function useTodos(userId: string) {
  const todos = useLiveQuery(
    () =>
      db.todos
        .where("userId")
        .equals(userId)
        .and((todo) => !todo._deletedAt)
        .sortBy("_lastModified"),
    [userId],
  );

  return { data: todos ?? [], isLoading: todos === undefined };
}
```

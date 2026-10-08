---
name: web-pwa-offline-first
description: Local-first architecture with sync queues
---

# Offline-First Application Patterns

> **Quick Guide:** Reads and writes go to a local database first and the network catches up
> afterwards. IndexedDB is the store — reached through a wrapper such as Dexie (reactive queries,
> larger) or idb (thin, ~1.2KB) — and every syncable record carries `_syncStatus`, `_lastModified`
> and `_localVersion` so the queue knows what is outstanding. Deletes are tombstones, never
> removals, or a delayed sync resurrects them. The Background Sync API is Chromium-only, so an
> `online` listener is the mechanism and background sync the optimisation.

**Detailed Resources:**

- [examples/core.md](examples/core.md) — syncable entity, repository, sync queue with backoff, connectivity detection, optimistic updates, hooks for status and mutations
- [examples/indexeddb.md](examples/indexeddb.md) — Dexie schema and migrations, the idb alternative, multi-tab coordination, quota management
- [examples/sync.md](examples/sync.md) — last-write-wins, field-level merge, conflict UI, version vectors, delta cursors, background sync, pull-push, status indicators
- [reference.md](reference.md) — storage and conflict-strategy selection, troubleshooting by symptom, performance and security notes

---

## Which path applies

- **Read-mostly, writes require connectivity** — a local copy for reading, refreshed when online,
  with no queue and no conflict resolution. Patterns 1, 4 and 6 are the whole of it.
- **Full CRUD offline** — mutations queue, conflicts happen, and every pattern here applies. Start
  at [examples/core.md](examples/core.md) and pick a resolution strategy from
  [examples/sync.md](examples/sync.md).

---

<critical_requirements>

## Before writing offline-first code

**Treat the local database as authoritative.** Every read comes from it and every write lands there
before anything is sent, which is what makes the UI answer instantly whatever the connection is
doing.

**Give every syncable record `_syncStatus`, `_lastModified` and `_localVersion`.** Without them
there is no way to ask what is outstanding, and no way to tell a conflict from a fresh write.

**Delete by writing a `_deletedAt` tombstone.** A removed row has nothing left to sync, so the next
pull brings the record back.

**Queue every mutation and drain the queue on reconnect, with exponential backoff and jitter.** A
transient 502 is otherwise a permanently lost write, and synchronised retries from many clients are
what turn a brief outage into a long one.

**Keep an IndexedDB transaction free of any other `await`.** The transaction closes as soon as
control returns to the event loop with no request pending, so an awaited `fetch` mid-transaction
fails with `TRANSACTION_INACTIVE_ERR`. Fetch first, then open the transaction.

</critical_requirements>

---

**Auto-detection:** IndexedDB, indexedDB.open, IDBDatabase, IDBObjectStore, openDB, DBSchema, Dexie,
useLiveQuery, dexie-react-hooks, idb-keyval, sync queue, tombstone, \_syncStatus, \_lastModified,
last-write-wins, version vector, offline-first, local-first, navigator.onLine, navigator.storage.persist,
BroadcastChannel, QuotaExceededError

**Applies to:**

- Choosing and shaping a local store that survives a reload and a disconnection
- Modelling sync metadata on records the user edits offline
- Queueing mutations, retrying them, and reporting what is outstanding
- Detecting real connectivity rather than a network interface
- Resolving concurrent edits, from last-write-wins to version vectors
- Showing the user what has saved locally and what has reached the server

**Handled elsewhere:**

- Intercepting network requests and versioning an HTTP response cache — a response cache stores
  what the server said and expires; this skill owns records the user authored
- Precaching an application shell so the app boots without a network
- Collaborative character-level editing, which wants a convergent replicated data type rather than
  a queue and a merge

---

<philosophy>

## Philosophy

The network is an enhancement. Local storage is the database, and the server is a peer it
reconciles with — which inverts the usual arrangement, where local storage is a cache of the truth.

Two things follow. Writes never block on a request, so the UI responds at disk speed rather than at
network speed. And every write becomes a claim that may be contested, which is why sync metadata is
foundational rather than an add-on: a record with no version is a record no merge can reason about.

```
User action
    │
Local database  ←── the single source of truth
    │
UI updates immediately
    │
Sync queue (background)
    │
Server, when reachable
    │
Conflict resolution, if the record moved on both sides
    │
Local database updated
```

The user's remaining job is trust: they need to see that a change is saved, that it is queued, and
that it eventually landed. Sync status is a product surface, not a debugging aid.

</philosophy>

---

<patterns>

## Core patterns

### Pattern 1: Syncable entity

Every other pattern reads these fields. Business data and sync metadata stay separate, with the
metadata prefixed so a merge can skip it wholesale.

```typescript
interface SyncableEntity {
  id: string;
  _syncStatus: "synced" | "pending" | "conflicted";
  _lastModified: number;
  _serverTimestamp?: number;
  _localVersion: string;
  _serverVersion?: string;
  _deletedAt?: number; // tombstone
}
```

Full code: [examples/core.md](examples/core.md)

### Pattern 2: Repository

One access point for a collection, so no caller has to remember that a write is two operations.
Reads filter tombstones; writes stamp metadata, save locally, then enqueue.

```typescript
interface DataRepository<T extends SyncableEntity> {
  get(id: string): Promise<T | null>; // null for a tombstone
  getAll(): Promise<T[]>;
  save(item: T): Promise<void>; // local write, then enqueue
  delete(id: string): Promise<void>; // tombstone, then enqueue
  getPendingCount(): Promise<number>;
}
```

Full code: [examples/core.md](examples/core.md)

### Pattern 3: Sync queue with backoff

Exponential delay bounded by a ceiling, plus jitter so reconnecting clients do not arrive together.

```typescript
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;
const JITTER_FACTOR = 0.5;

function calculateBackoff(attempt: number): number {
  const delay = Math.min(INITIAL_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
  const jitter = delay * JITTER_FACTOR * (Math.random() * 2 - 1);
  return Math.floor(delay + jitter);
}
```

Full code: [examples/core.md](examples/core.md) — retry limits, ordering by timestamp, dead-letter
handling

### Pattern 4: Connectivity detection

`navigator.onLine` reports whether a network interface exists, which is true behind a captive
portal and on a router with no upstream. Confirm with a request.

```typescript
async function checkConnectivity(): Promise<boolean> {
  if (!navigator.onLine) return false; // cheap negative, trustworthy
  try {
    const response = await fetch("/api/health", {
      method: "HEAD",
      cache: "no-store",
    });
    return response.ok;
  } catch {
    return false;
  }
}
```

Full code: [examples/core.md](examples/core.md) — latency sampling and a "slow" state

### Pattern 5: Optimistic update with rollback

Capture the previous value before writing and hand back the undo, so the caller's error path is one
call rather than a reconstruction.

```typescript
async function applyOptimistically<T>(id: string, next: T) {
  const previous = (await localDb.get(id)) ?? null;
  await localDb.put(next);

  return async function rollback() {
    if (previous) await localDb.put(previous);
    else await localDb.delete(id);
  };
}
```

Full code: [examples/core.md](examples/core.md)

### Pattern 6: Connection-aware fetching

Return where the data came from alongside the data, so the UI can say "showing saved data" instead
of silently presenting something stale as current.

```typescript
interface FetchResult<T> {
  data: T;
  source: "network" | "cache";
  timestamp: number;
}

// try network with a timeout, cache the success, fall back to cache on any failure
const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
```

Full code: [examples/core.md](examples/core.md)

### Pattern 7: Conflict resolution

Three strategies, in increasing cost. Pick by what the field means, not by what is easiest.

- **Last-write-wins** — most recent timestamp takes the record. Correct for independent values;
  wrong wherever two people edited different fields. [examples/sync.md](examples/sync.md)
  Pattern 17.
- **Field-level merge** — compare each field against the last common state and conflict only where
  both sides moved the same one. [examples/sync.md](examples/sync.md) Pattern 18.
- **Version vectors** — a per-client counter that distinguishes a concurrent edit from a sequential
  one without trusting any clock. [examples/sync.md](examples/sync.md) Pattern 20.

Where neither side can be discarded, surface the conflict and let the user choose:
[examples/sync.md](examples/sync.md) Pattern 19.

</patterns>

---

<red_flags>

## Red flags

**Breaks at runtime:**

- `await fetch(...)` or `await new Promise(setTimeout)` inside an IndexedDB transaction — the
  transaction has already closed and the next operation throws `TRANSACTION_INACTIVE_ERR` — do the
  async work first, then open a short transaction
- A hard delete on a record that has not synced — the next pull resurrects it — write `_deletedAt`
  and sweep tombstones once they are confirmed synced
- Writing without checking the quota — `QuotaExceededError` surfaces as a failed save with no
  warning — check `navigator.storage.estimate()` and evict before writing
- An unbounded queue — a long offline session exhausts storage, and draining it all at once
  exhausts memory — cap the queue and batch the drain
- Awaiting the server before updating the UI — the app is now online-first with extra steps — save
  locally, then enqueue

**Surprising behaviour:**

- `navigator.onLine === true` means an interface exists, not that anything is reachable
- Safari caps script-writable storage at seven days without user interaction, IndexedDB included;
  `navigator.storage.persist()` helps and an installed app helps more
- `navigator.storage.estimate()` needs a secure context and answers `{ usage: 0, quota: 0 }`
  otherwise
- Background Sync is Chromium-only, so an `online` listener has to carry the load everywhere else
- IndexedDB has no boolean index type — a compound query matches `[userId+completed]` against
  `[userId, 1]`
- Dexie's `useLiveQuery` returns `undefined` while loading, not `null`, so a `=== undefined` check
  is the loading state
- Two tabs write to one database with no coordination; `BroadcastChannel` is how they agree
  ([examples/indexeddb.md](examples/indexeddb.md) Pattern 15)
- Comparing timestamps across devices detects difference, not causality — clock drift makes a
  sequential edit look concurrent and the reverse

</red_flags>

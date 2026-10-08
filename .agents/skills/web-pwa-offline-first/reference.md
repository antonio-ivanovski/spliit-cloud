# Offline-First Reference

> Selection guides, troubleshooting by symptom, and performance and security notes. Concepts and red
> flags are in [SKILL.md](SKILL.md); code is in [examples/](examples/).

---

## Selection guides

### Storage

```
What is being stored?
├─ Structured records the user edits
│   ├─ Want queries that re-run when the data changes?
│   │   ├─ YES → Dexie (liveQuery, richer API, larger bundle)
│   │   └─ NO  → idb (thin promise wrapper over IndexedDB, ~1.2KB)
│   └─ Relational joins across many collections?
│       └─ SQLite compiled to WebAssembly, or an embedded database with
│          replication built in
├─ Small key-value pairs, non-critical
│   └─ localStorage (5MB, synchronous) or a key-value wrapper over IndexedDB
├─ Large binaries
│   └─ Cache API, the Origin Private File System, or the File System Access API
└─ Secrets
    └─ Encrypt with Web Crypto before writing; IndexedDB is plaintext at rest
```

| Store        | Limit                         | Notes                                  |
| ------------ | ----------------------------- | -------------------------------------- |
| localStorage | ~5MB per origin               | Synchronous, blocks the main thread    |
| IndexedDB    | Up to ~50% of free disk       | Asynchronous, indexed queries          |
| Safari       | 7-day cap without interaction | Applies to all script-writable storage |

Request `navigator.storage.persist()` to opt out of best-effort eviction.

### Conflict resolution

```
What kind of value is in conflict?
├─ Independent scalar (a flag, a counter, a status)
│   └─ Last-write-wins
├─ A record whose fields are edited separately
│   └─ Field-level merge
├─ Business-critical, where guessing is unacceptable
│   └─ Surface it and let the user decide
├─ An ordered list
│   └─ Fractional indexing, resolved with last-write-wins per item
└─ Character-level collaborative text
    └─ A convergent replicated data type — a different model from a sync
       queue, and out of scope here
```

### Sync frequency

```
How fresh does the data need to be?
├─ Sub-second      → A persistent connection with a local cache; this is not
│                     offline-first, and the two designs do not compose well
├─ Seconds         → Poll, with optimistic updates covering the gap
├─ Minutes         → Background Sync where available, an `online` listener
│                     everywhere else
└─ On demand       → A user-triggered sync control
```

### Offline scope

| The app must…                     | Needs                                            |
| --------------------------------- | ------------------------------------------------ |
| Read while disconnected           | A local copy, refreshed when online              |
| Create, update and delete offline | Local store, sync queue, conflict resolution     |
| Support concurrent editors        | The above plus a merge model per field or record |
| Nothing offline                   | None of this — the complexity is real            |

---

## Troubleshooting

| Symptom                              | Usually                                                                        | Check                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Data vanishes after a sync           | The server rejected the write, or a conflict resolved server-side              | Log sync failures; surface conflicts; confirm deletes are tombstones           |
| Duplicates appear after a sync       | Server-assigned IDs never written back, or two devices created the same record | Generate UUIDs client-side; deduplicate on a content hash                      |
| The queue never empties              | The server rejects an operation every time, and nothing retires it             | Add a retry ceiling and a dead-letter path; surface the server's error         |
| An optimistic update reverts         | Server validation, authorisation, or a newer server record                     | Validate locally before applying; keep a "pending" state until confirmed       |
| `QuotaExceededError`                 | Tombstones never swept, or the queue grew unbounded                            | Sweep synced tombstones; cap the queue; request persistent storage             |
| Data disappears after ~7 days on iOS | Safari's script-writable storage cap                                           | Call `navigator.storage.persist()`; prompt for an install; back up server-side |
| Slow start                           | Everything loaded at boot, or a query with no index                            | Paginate; index the queried fields; use cursors rather than `getAll()`         |

---

## Performance

| Operation          | Do this                                          |
| ------------------ | ------------------------------------------------ |
| Bulk reads         | Query an index rather than filtering a full scan |
| Bulk writes        | One transaction, many `put` calls                |
| Large collections  | Paginate, and virtualise the list                |
| Multi-field filter | Add a compound index                             |
| Reactive views     | A live query, rather than polling                |

| Sync approach       | When                                   |
| ------------------- | -------------------------------------- |
| Delta sync          | Default — send only what changed       |
| Batched uploads     | Many small mutations                   |
| Compressed payloads | Large volumes                          |
| Background sync     | Non-urgent updates                     |
| Priority queueing   | Some mutations matter more than others |

Process large datasets in batches and yield between them, so a long scan does not hold the main
thread:

```typescript
const BATCH_SIZE = 100;

async function processLargeDataset(db: Database): Promise<void> {
  let offset = 0;

  while (true) {
    const batch = await db.todos.offset(offset).limit(BATCH_SIZE).toArray();
    if (batch.length === 0) break;

    await processBatch(batch);
    offset += BATCH_SIZE;

    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
```

---

## Testing offline

Two ways to simulate a disconnection without touching a network setting:

```typescript
// Replace fetch
function createOfflineFetch(): typeof fetch {
  return async () => {
    throw new TypeError("Failed to fetch");
  };
}

// Force the flag the code branches on
Object.defineProperty(navigator, "onLine", {
  get: () => false,
  configurable: true,
});
```

Scenarios worth covering: create, edit and delete while offline all queue; the queue drains on
reconnect; a failed operation retries with backoff and eventually stops; a divergent server record
is detected as a conflict and its resolution persists. Then the edges — rapid connect/disconnect
cycles, two tabs editing one record, an exceeded quota, a large queue, and a request that times out
rather than failing.

---

## Security

IndexedDB is not encrypted. For anything sensitive, encrypt the value before writing and decrypt on
read:

```typescript
async function saveSensitiveData(
  key: string,
  data: SensitiveData,
): Promise<void> {
  const encrypted = await encrypt(
    JSON.stringify(data),
    await getEncryptionKey(),
  );
  await db.sensitiveStore.put({ key, encrypted });
}
```

Session tokens are better held in an `HttpOnly` cookie than in any script-readable store. On logout,
clear the sensitive store and the sync queue, and keep the non-sensitive cached data so the app
still opens offline.

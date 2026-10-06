# Service Worker — Caching Examples

> Strategies beyond the four in [core.md](core.md). Decisions are in [SKILL.md](../SKILL.md).

---

## Pattern 5: Cache-first with background refresh

Serve the cached copy now and refresh it for the next visit. Suits content where staleness within a
session is acceptable but staleness across sessions is not.

```typescript
async function cacheFirstWithBackgroundRefresh(
  request: Request,
  cacheName: string,
): Promise<Response> {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);

  const refreshPromise = fetch(request)
    .then((networkResponse) => {
      if (networkResponse.ok) cache.put(request, networkResponse.clone());
      return networkResponse;
    })
    .catch(() => null);

  if (cachedResponse) return cachedResponse;

  const networkResponse = await refreshPromise;
  if (networkResponse) return networkResponse;

  throw new Error("No cached or network response available");
}

export { cacheFirstWithBackgroundRefresh };
```

---

## Pattern 6: Cache with expiration

The Cache API stores no timestamps, so age has to be tracked alongside. Keep the timestamps in
IndexedDB rather than in memory — the worker is terminated between events.

```typescript
const EXPIRATION_DB_NAME = "cache-expiration";
const EXPIRATION_STORE_NAME = "timestamps";

const MAX_AGE_SECONDS = {
  api: 5 * 60,
  images: 30 * 24 * 60 * 60,
  static: 7 * 24 * 60 * 60,
} as const;

async function cacheFirstWithExpiration(
  request: Request,
  cacheName: string,
  maxAgeSeconds: number,
): Promise<Response> {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);

  if (cachedResponse && !(await isCacheExpired(request.url, maxAgeSeconds))) {
    return cachedResponse;
  }

  const networkResponse = await fetch(request);
  if (networkResponse.ok) {
    await cacheWithTimestamp(cache, request, networkResponse);
  }
  return networkResponse;
}

async function cacheWithTimestamp(
  cache: Cache,
  request: Request,
  response: Response,
): Promise<void> {
  await cache.put(request, response.clone());

  const db = await openExpirationDB();
  const tx = db.transaction(EXPIRATION_STORE_NAME, "readwrite");
  tx.objectStore(EXPIRATION_STORE_NAME).put({
    url: request.url,
    timestamp: Date.now(),
  });
}

async function isCacheExpired(
  url: string,
  maxAgeSeconds: number,
): Promise<boolean> {
  try {
    const db = await openExpirationDB();
    const tx = db.transaction(EXPIRATION_STORE_NAME, "readonly");
    const entry = await tx.objectStore(EXPIRATION_STORE_NAME).get(url);

    if (!entry) return true;
    return Date.now() - entry.timestamp > maxAgeSeconds * 1000;
  } catch {
    return true; // an unreadable timestamp means refetch, never serve stale
  }
}

function openExpirationDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(EXPIRATION_DB_NAME, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(EXPIRATION_STORE_NAME)) {
        db.createObjectStore(EXPIRATION_STORE_NAME, { keyPath: "url" });
      }
    };
  });
}

export { cacheFirstWithExpiration, MAX_AGE_SECONDS };
```

---

## Pattern 7: Per-endpoint routing

A declarative table beats a chain of `if`s once more than two endpoints differ. First match wins, so
order from most specific to least.

```typescript
type ApiCacheConfig = {
  pattern: RegExp;
  strategy: "network-first" | "stale-while-revalidate" | "cache-first";
  maxAgeSeconds: number;
  maxEntries: number;
};

const API_CACHE_NAME = "api-cache";

const API_CACHE_CONFIG: ApiCacheConfig[] = [
  {
    pattern: /\/api\/users\/me$/,
    strategy: "stale-while-revalidate",
    maxAgeSeconds: 5 * 60,
    maxEntries: 1,
  },
  {
    pattern: /\/api\/products/,
    strategy: "cache-first",
    maxAgeSeconds: 60 * 60,
    maxEntries: 50,
  },
  {
    pattern: /\/api\/search/,
    strategy: "network-first",
    maxAgeSeconds: 60,
    maxEntries: 20,
  },
  {
    pattern: /\/api\//,
    strategy: "network-first",
    maxAgeSeconds: 5 * 60,
    maxEntries: 100,
  },
];

function findCacheConfig(url: string): ApiCacheConfig | null {
  return API_CACHE_CONFIG.find((config) => config.pattern.test(url)) ?? null;
}

async function handleApiRequest(request: Request): Promise<Response> {
  const config = findCacheConfig(request.url);
  if (!config) return fetch(request);

  switch (config.strategy) {
    case "cache-first":
      return cacheFirst(request, API_CACHE_NAME);
    case "network-first":
      return networkFirst(request, API_CACHE_NAME);
    case "stale-while-revalidate":
      return staleWhileRevalidate(request, API_CACHE_NAME);
  }
}

export { handleApiRequest, API_CACHE_CONFIG };
export type { ApiCacheConfig };
```

---

## Pattern 8: Navigation preload

Enable in activate, consume in fetch. Skip this for a precached app shell; there is no network
request to overlap with.

```typescript
declare const self: ServiceWorkerGlobalScope;

const PAGES_CACHE = "pages-v1";

self.addEventListener("activate", (event: ExtendableEvent) => {
  event.waitUntil(
    (async () => {
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable();
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event: FetchEvent) => {
  if (event.request.mode !== "navigate") return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(PAGES_CACHE);

      try {
        const preloadResponse = await event.preloadResponse;
        if (preloadResponse) {
          cache.put(event.request, preloadResponse.clone());
          return preloadResponse;
        }

        const networkResponse = await fetch(event.request);
        if (networkResponse.ok) {
          cache.put(event.request, networkResponse.clone());
        }
        return networkResponse;
      } catch {
        const cachedResponse = await cache.match(event.request);
        if (cachedResponse) return cachedResponse;

        const offlinePage = await caches.match("/offline.html");
        if (offlinePage) return offlinePage;

        return new Response("Offline", { status: 503 });
      }
    })(),
  );
});
```

The `fetch` fallback runs only when preload is unavailable — a browser without support, or a request
that arrived before activate finished. Keeping both paths is what makes the handler safe to ship
before checking support.

---

## Pattern 9: Storage cleanup

Watch the quota and evict before a write throws. `navigator.storage.estimate()` needs a secure
context and returns zeros without one.

```typescript
const STORAGE_QUOTA_THRESHOLD = 0.9;
const CLEANUP_PERCENTAGE = 0.3;

interface StorageEstimate {
  quota: number;
  usage: number;
  percentUsed: number;
}

async function getStorageEstimate(): Promise<StorageEstimate | null> {
  if (!navigator.storage?.estimate) return null;

  const estimate = await navigator.storage.estimate();
  const quota = estimate.quota ?? 0;
  const usage = estimate.usage ?? 0;

  return { quota, usage, percentUsed: quota > 0 ? usage / quota : 0 };
}

async function checkAndCleanup(): Promise<void> {
  const estimate = await getStorageEstimate();
  if (!estimate || estimate.percentUsed <= STORAGE_QUOTA_THRESHOLD) return;

  const cacheNames = await caches.keys();

  for (const cacheName of cacheNames) {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    const deleteCount = Math.floor(keys.length * CLEANUP_PERCENTAGE);

    if (deleteCount > 0) {
      // cache.keys() returns insertion order, so the head is the oldest
      const toDelete = keys.slice(0, deleteCount);
      await Promise.all(toDelete.map((key) => cache.delete(key)));
    }
  }
}

export { checkAndCleanup, getStorageEstimate };
export type { StorageEstimate };
```

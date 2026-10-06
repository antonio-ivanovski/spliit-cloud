# Service Worker — Core Examples

> Registration and the full lifecycle template. Decisions are in [SKILL.md](../SKILL.md);
> [caching.md](caching.md) has the advanced strategies and [updates.md](updates.md) the update
> handling.

---

## Pattern 1: Registration

Feature detection, periodic update checks, waiting-worker tracking, and a single reload on
controller change.

```typescript
// register-service-worker.ts
const SW_PATH = "/sw.js";
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

interface ServiceWorkerState {
  registration: ServiceWorkerRegistration | null;
  updateAvailable: boolean;
  applyUpdate: () => void;
}

const NOT_SUPPORTED: ServiceWorkerState = {
  registration: null,
  updateAvailable: false,
  applyUpdate: () => {},
};

async function registerServiceWorker(): Promise<ServiceWorkerState> {
  if (!("serviceWorker" in navigator)) return NOT_SUPPORTED;

  try {
    const registration = await navigator.serviceWorker.register(SW_PATH, {
      scope: "/",
      updateViaCache: "none",
    });

    setInterval(() => registration.update(), UPDATE_CHECK_INTERVAL_MS);

    let updateAvailable = false;
    let waitingWorker: ServiceWorker | null = null;

    const handleUpdate = (worker: ServiceWorker) => {
      waitingWorker = worker;
      updateAvailable = true;
      window.dispatchEvent(new CustomEvent("sw-update-available"));
    };

    if (registration.waiting) handleUpdate(registration.waiting);

    registration.addEventListener("updatefound", () => {
      const installing = registration.installing;
      if (!installing) return;

      installing.addEventListener("statechange", () => {
        const supersedesActive =
          installing.state === "installed" &&
          navigator.serviceWorker.controller;
        if (supersedesActive) handleUpdate(installing);
      });
    });

    // controllerchange can fire more than once; reload only the first time
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });

    return {
      registration,
      updateAvailable,
      applyUpdate: () => waitingWorker?.postMessage({ type: "SKIP_WAITING" }),
    };
  } catch (error) {
    console.error("Service Worker registration failed:", error);
    return NOT_SUPPORTED;
  }
}

export { registerServiceWorker };
export type { ServiceWorkerState };
```

The `sw-update-available` event keeps the UI decoupled: any component can listen without importing
the registration module.

---

## Pattern 2: Complete service worker

All lifecycle handlers, the four strategies, versioned caches, and size limits.

```typescript
// sw.ts
declare const self: ServiceWorkerGlobalScope;

const CACHE_VERSION = "v1.0.0";

const CACHES = {
  static: `static-${CACHE_VERSION}`,
  pages: `pages-${CACHE_VERSION}`,
  images: `images-${CACHE_VERSION}`,
  api: `api-${CACHE_VERSION}`,
} as const;

type CacheName = (typeof CACHES)[keyof typeof CACHES];

const PRECACHE_URLS = [
  "/",
  "/offline.html",
  "/manifest.json",
  "/styles/app.css",
  "/scripts/app.js",
  "/images/logo.svg",
] as const;

const MAX_CACHE_ITEMS = { images: 100, api: 50 } as const;
const NETWORK_TIMEOUT_MS = 3000;

async function limitCacheSize(cache: Cache, maxItems: number): Promise<void> {
  const keys = await cache.keys();
  if (keys.length <= maxItems) return;

  const toDelete = keys.slice(0, keys.length - maxItems);
  await Promise.all(toDelete.map((request) => cache.delete(request)));
}

async function cacheFirst(
  request: Request,
  cacheName: CacheName,
): Promise<Response> {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);
  if (cachedResponse) return cachedResponse;

  const networkResponse = await fetch(request);
  if (networkResponse.ok) cache.put(request, networkResponse.clone());
  return networkResponse;
}

async function networkFirst(
  request: Request,
  cacheName: CacheName,
  timeoutMs: number = NETWORK_TIMEOUT_MS,
): Promise<Response> {
  const cache = await caches.open(cacheName);

  try {
    const networkResponse = await Promise.race([
      fetch(request),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Network timeout")), timeoutMs),
      ),
    ]);

    if (networkResponse.ok) cache.put(request, networkResponse.clone());
    return networkResponse;
  } catch {
    const cachedResponse = await cache.match(request);
    if (cachedResponse) return cachedResponse;

    if (request.mode === "navigate") {
      const offlinePage = await caches.match("/offline.html");
      if (offlinePage) return offlinePage;
    }

    return new Response("Offline", { status: 503 });
  }
}

async function staleWhileRevalidate(
  request: Request,
  cacheName: CacheName,
): Promise<Response> {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);

  const fetchPromise = fetch(request)
    .then(async (networkResponse) => {
      if (networkResponse.ok) {
        await limitCacheSize(cache, MAX_CACHE_ITEMS.api);
        cache.put(request, networkResponse.clone());
      }
      return networkResponse;
    })
    .catch(() => null);

  if (cachedResponse) return cachedResponse;

  const networkResponse = await fetchPromise;
  return networkResponse ?? new Response("No data available", { status: 503 });
}

async function cacheFirstWithLimit(
  request: Request,
  cacheName: CacheName,
  maxItems: number,
): Promise<Response> {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);
  if (cachedResponse) return cachedResponse;

  const networkResponse = await fetch(request);
  if (networkResponse.ok) {
    await limitCacheSize(cache, maxItems - 1);
    cache.put(request, networkResponse.clone());
  }
  return networkResponse;
}

self.addEventListener("install", (event: ExtendableEvent) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHES.static);
      const results = await Promise.allSettled(
        PRECACHE_URLS.map((url) => cache.add(url)),
      );

      const failed = results.filter((r) => r.status === "rejected");
      if (failed.length > 0) {
        console.error("[SW] Failed to precache some assets:", failed);
      }
    })(),
  );
});

self.addEventListener("activate", (event: ExtendableEvent) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();
      const currentCaches: string[] = Object.values(CACHES);

      await Promise.all(
        cacheNames
          .filter((name) => !currentCaches.includes(name))
          .map((name) => caches.delete(name)),
      );

      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event: FetchEvent) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== "GET") return;
  if (url.origin !== location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, CACHES.pages));
  } else if (request.destination === "image") {
    event.respondWith(
      cacheFirstWithLimit(request, CACHES.images, MAX_CACHE_ITEMS.images),
    );
  } else if (url.pathname.startsWith("/api/")) {
    event.respondWith(staleWhileRevalidate(request, CACHES.api));
  } else {
    event.respondWith(cacheFirst(request, CACHES.static));
  }
});

self.addEventListener("message", (event: ExtendableMessageEvent) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});
```

`Promise.allSettled` in install matters: `cache.addAll` rejects the whole batch if any single URL
fails, which fails the installation over one missing asset.

---

## Pattern 3: Message types

A discriminated union in a `.d.ts` file makes the client-worker protocol checkable at both ends.

```typescript
// types/service-worker.d.ts
declare const self: ServiceWorkerGlobalScope;

type ServiceWorkerMessage =
  | { type: "SKIP_WAITING" }
  | { type: "GET_VERSION"; requestId: string }
  | { type: "CLEAR_CACHE"; cacheName: string };

type ClientMessage =
  | { type: "VERSION_RESPONSE"; version: string; requestId: string }
  | { type: "CACHE_CLEARED"; cacheName: string }
  | { type: "UPDATE_AVAILABLE"; version: string };
```

---

## Pattern 4: Precache with a critical/optional split

Installation should fail on a missing app shell and survive a missing decorative asset.

```typescript
interface PrecacheResult {
  successful: string[];
  failed: string[];
}

const PRECACHE_URLS = [
  { url: "/", critical: true },
  { url: "/offline.html", critical: true },
  { url: "/manifest.json", critical: true },
  { url: "/styles/app.css", critical: false },
  { url: "/scripts/app.js", critical: false },
  { url: "/images/logo.svg", critical: false },
] as const;

async function precacheWithFallback(
  cacheName: string,
): Promise<PrecacheResult> {
  const cache = await caches.open(cacheName);
  const result: PrecacheResult = { successful: [], failed: [] };

  for (const { url } of PRECACHE_URLS.filter((p) => p.critical)) {
    try {
      await cache.add(url);
      result.successful.push(url);
    } catch {
      throw new Error(`Critical asset failed to cache: ${url}`);
    }
  }

  const optionalUrls = PRECACHE_URLS.filter((p) => !p.critical);
  const optionalResults = await Promise.allSettled(
    optionalUrls.map(({ url }) => cache.add(url)),
  );

  optionalResults.forEach((settled, index) => {
    const { url } = optionalUrls[index];
    if (settled.status === "fulfilled") result.successful.push(url);
    else result.failed.push(url);
  });

  return result;
}

export { precacheWithFallback };
export type { PrecacheResult };
```

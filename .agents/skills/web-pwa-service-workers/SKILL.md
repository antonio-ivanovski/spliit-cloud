---
name: web-pwa-service-workers
description: Service Worker lifecycle, caching strategies, offline patterns, update handling, precaching, runtime caching
---

# Service Worker Patterns

> **Quick Guide:** A service worker is a programmable network proxy with its own lifecycle:
> install precaches, activate cleans up, fetch intercepts. Match the caching strategy to the
> content — cache-first for hashed assets, network-first for HTML, stale-while-revalidate for
> non-critical API reads. Two details cause most bugs: a response body can be read once, so
> `cache.put(request, response.clone())`, and a new worker waits until every tab using the old one
> closes, so updates need explicit detection and a user-triggered `skipWaiting`.

**Detailed Resources:**

- [examples/core.md](examples/core.md) — registration, the full lifecycle template, the four strategy implementations, message types
- [examples/caching.md](examples/caching.md) — background refresh, expiry timestamps, per-endpoint routing, navigation preload, quota cleanup
- [examples/updates.md](examples/updates.md) — version messaging, aggressive/deferred/idle updates, progressive rollout, cache migration
- [reference.md](reference.md) — strategy-by-content-type table, lifecycle and Cache API lookup, update-strategy selection, review checklist

---

## Which path applies

- **Precached app shell** — the HTML is one cached document and routing happens client-side. Serve
  it cache-first, and skip navigation preload; there is nothing to preload.
- **Server-rendered or authenticated pages** — each navigation is a fresh document. Serve
  network-first with a timeout and an offline fallback, and enable navigation preload so the
  request starts before the worker boots. Follow
  [examples/caching.md](examples/caching.md) Pattern 8.

---

<critical_requirements>

## Before writing service worker code

**Wrap every async lifecycle task in `event.waitUntil()`.** It keeps the worker alive until the
promise settles; without it the browser is free to terminate mid-precache.

**Put a version in every cache name and delete the non-current ones during activate.** That is
what makes an upgrade clean and keeps storage from growing without bound.

**Clone before caching — `cache.put(request, response.clone())`.** A response body can be consumed
once, so caching the original leaves the client with an empty response.

**Let the client decide when a waiting worker takes over.** Detect the waiting worker, tell the
user, and call `skipWaiting()` in response to their message, so behaviour never changes underneath
an open session.

**Give every fetch path a fallback.** A precached `offline.html` for navigations and a constructed
`Response` as the last resort turn a network failure into a page you wrote.

</critical_requirements>

---

**Auto-detection:** navigator.serviceWorker, serviceWorker.register, ServiceWorkerGlobalScope,
sw.js, sw.ts, self.skipWaiting, clients.claim, event.waitUntil, event.respondWith,
event.preloadResponse, caches.open, caches.match, cache.addAll, CacheStorage, navigationPreload,
updateViaCache, controllerchange, updatefound, precache

**Applies to:**

- Intercepting and answering network requests from a worker thread
- Choosing and implementing a caching strategy per content type
- Precaching an app shell and cleaning up superseded caches
- Detecting a waiting worker and applying the update on the user's terms
- Serving an offline fallback when both cache and network fail

**Handled elsewhere:**

- Structured local data that the application owns and writes — a response cache stores what the
  server said, which is a different lifetime from records a user edits offline
- Queueing mutations made while disconnected and reconciling them later
- Push notification content and permission flows — the worker's `push` event is a delivery hook,
  and what to show is a product decision

---

<philosophy>

## Philosophy

A service worker is a proxy, not a plugin: once installed it sees every request in its scope, and
anything it fails to answer, it breaks.

The lifecycle exists to stop two versions running at once. A new worker installs immediately but
**waits** until every client controlled by the old one has gone, so one page never runs half the old
assets and half the new ones.

```
Registration → Download → Install → Waiting → Activate → Fetch
                            ↓          ↓
                     (skipWaiting)  (claim)
```

`skipWaiting()` and `clients.claim()` are the two escapes from that guarantee, and both are opt-in
for a reason. Reach for them when the user has asked for the update, or when a fix is urgent enough
to be worth a mid-session change.

</philosophy>

---

<patterns>

## Core patterns

### Pattern 1: Registration with update detection

Register with feature detection, check for updates periodically, and track the waiting worker so
the UI can offer the update.

```typescript
const registration = await navigator.serviceWorker.register("/sw.js", {
  scope: "/",
  updateViaCache: "none", // ask the server for the worker script every time
});

setInterval(() => registration.update(), UPDATE_CHECK_INTERVAL_MS);

registration.addEventListener("updatefound", () => {
  const installing = registration.installing;
  installing?.addEventListener("statechange", () => {
    const isWaiting =
      installing.state === "installed" && navigator.serviceWorker.controller;
    if (isWaiting) notifyUpdateAvailable();
  });
});
```

Full code: [examples/core.md](examples/core.md)

### Pattern 2: Lifecycle handlers

Precache in install, delete superseded caches in activate, and take `skipWaiting` as a message
rather than calling it unconditionally.

```typescript
self.addEventListener("install", (event: ExtendableEvent) => {
  event.waitUntil(
    caches.open(CACHES.static).then((cache) => cache.addAll(PRECACHE_URLS)),
  );
});

self.addEventListener("activate", (event: ExtendableEvent) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      const current: string[] = Object.values(CACHES);
      await Promise.all(
        names.filter((n) => !current.includes(n)).map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event: ExtendableMessageEvent) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});
```

Full code: [examples/core.md](examples/core.md)

### Pattern 3: Caching strategies

Four strategies cover almost everything. Which content gets which is in
[reference.md](reference.md).

| Strategy                      | Behaviour                                       |
| ----------------------------- | ----------------------------------------------- |
| **Cache-first**               | Serve the cached copy, fall back to the network |
| **Network-first**             | Race the network against a timeout, then cache  |
| **Stale-while-revalidate**    | Serve the cached copy and refresh in background |
| **Cache-only / network-only** | One source, no fallback                         |

Each implementation checks `response.ok` before caching, clones before `cache.put`, and caps the
number of entries.

```typescript
const networkResponse = await fetch(request);
if (networkResponse.ok) {
  cache.put(request, networkResponse.clone()); // the clone is cached
}
return networkResponse; // the original goes to the client
```

Full code: [examples/core.md](examples/core.md); expiry and per-endpoint variants in
[examples/caching.md](examples/caching.md)

### Pattern 4: Fetch routing

Route by request shape rather than by URL alone: `request.mode`, `request.destination` and the
pathname each answer a different question. Returning without calling `respondWith` lets the browser
handle the request normally.

```typescript
self.addEventListener("fetch", (event: FetchEvent) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== "GET") return;
  if (url.origin !== location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, CACHES.pages));
  } else if (request.destination === "image") {
    event.respondWith(cacheFirstWithLimit(request, CACHES.images, MAX_IMAGES));
  } else if (url.pathname.startsWith("/api/")) {
    event.respondWith(staleWhileRevalidate(request, CACHES.api));
  } else {
    event.respondWith(cacheFirst(request, CACHES.static));
  }
});
```

Full code: [examples/core.md](examples/core.md)

### Pattern 5: Offline fallback

Precache an offline page in install and serve it when a navigation has no cache entry and no
network. Construct a `Response` as the final resort, so there is no path that ends in the browser's
own error page.

```typescript
if (request.mode === "navigate") {
  const offlinePage = await caches.match("/offline.html");
  if (offlinePage) return offlinePage;
}

return new Response("<h1>Offline</h1><p>Check your connection.</p>", {
  status: 503,
  headers: { "Content-Type": "text/html" },
});
```

Full code: [examples/core.md](examples/core.md)

### Pattern 6: Navigation preload

Worker bootup costs roughly 50ms on desktop and 250ms or more on a slow phone, and a network-first
navigation pays it before the request even starts. Navigation preload starts the request in
parallel with bootup.

```typescript
// activate
if (self.registration.navigationPreload) {
  await self.registration.navigationPreload.enable();
}

// fetch
const preloadResponse = await event.preloadResponse;
if (preloadResponse) {
  cache.put(event.request, preloadResponse.clone());
  return preloadResponse;
}
```

Once enabled, consume `event.preloadResponse`; calling `fetch(event.request)` instead makes two
network requests for the same resource.

Full code: [examples/caching.md](examples/caching.md)

### Pattern 7: User-controlled updates

Show the waiting worker to the user, post `SKIP_WAITING` when they accept, and reload once on
`controllerchange` so the page and the worker agree.

```typescript
if (registration.waiting) showUpdateBanner();

function applyUpdate() {
  registration.waiting?.postMessage({ type: "SKIP_WAITING" });
}

let refreshing = false;
navigator.serviceWorker.addEventListener("controllerchange", () => {
  if (refreshing) return;
  refreshing = true;
  window.location.reload();
});
```

Full code: [examples/updates.md](examples/updates.md) — version messaging, deferred and idle
application, progressive rollout, cache migration

</patterns>

---

<red_flags>

## Red flags

**Breaks at runtime:**

- Async work in install or activate without `event.waitUntil()` — the browser may terminate the
  worker mid-task — wrap the promise
- `cache.put(request, response)` without `.clone()` — the body is consumed and the client receives
  nothing — cache the clone and return the original
- Caching without checking `response.ok` — a 404 or 500 is stored and served back for the life of
  the cache — gate the `put`
- Unversioned cache names — activate has no way to tell current caches from superseded ones —
  interpolate a version constant
- No `offline.html` for navigations — the user gets the browser's error page — precache one in
  install and return it from the fetch error path
- `fetch(event.request)` in a worker with navigation preload enabled — every navigation makes two
  network requests — consume `event.preloadResponse`
- Trying to cache a POST — the Cache API keys on GET requests — return early on
  `request.method !== "GET"`

**Surprising behaviour:**

- Scope follows the script's location: `/sw.js` controls `/`, but `/scripts/sw.js` controls only
  `/scripts/`
- Service workers need HTTPS, with localhost exempted for development
- An idle worker is terminated and restarted, so module-level state does not survive between events
- `clients.claim()` takes control without reloading, so an open page keeps the old HTML alongside
  the new worker
- Only a byte change to the worker script triggers an update — editing the web app manifest or a
  precached asset does not
- DevTools "Update on reload" bypasses the waiting phase, so update handling looks correct in
  development and fails in production
- Opaque cross-origin responses count against the storage quota at a padded size far above their
  real one
- Network-first without a timeout hangs indefinitely on a connection that is technically up

</red_flags>

# Service Worker — Update Examples

> Version communication and the five ways to apply a waiting worker. Which one to pick is in
> [reference.md](../reference.md); the lifecycle they build on is in [core.md](core.md).

---

## Pattern 10: Version communication

A typed protocol in both directions, so a client can ask which version is running and the worker can
announce itself on activation.

```typescript
// sw.ts
declare const self: ServiceWorkerGlobalScope;

const SW_VERSION = "1.2.0";

type ClientBoundMessage =
  | { type: "VERSION"; version: string }
  | { type: "UPDATE_AVAILABLE"; newVersion: string }
  | { type: "CACHE_UPDATED"; cacheName: string };

type WorkerBoundMessage =
  | { type: "GET_VERSION" }
  | { type: "SKIP_WAITING" }
  | { type: "CHECK_UPDATE" };

self.addEventListener("message", async (event: ExtendableMessageEvent) => {
  const message = event.data as WorkerBoundMessage;

  switch (message.type) {
    case "GET_VERSION":
      event.source?.postMessage({
        type: "VERSION",
        version: SW_VERSION,
      } as ClientBoundMessage);
      break;

    case "SKIP_WAITING":
      await self.skipWaiting();
      break;

    case "CHECK_UPDATE":
      await self.registration.update();
      break;
  }
});

async function notifyClients(message: ClientBoundMessage): Promise<void> {
  const clients = await self.clients.matchAll({ type: "window" });
  for (const client of clients) {
    client.postMessage(message);
  }
}

self.addEventListener("activate", (event: ExtendableEvent) => {
  event.waitUntil(
    (async () => {
      await self.clients.claim();
      await notifyClients({ type: "UPDATE_AVAILABLE", newVersion: SW_VERSION });
    })(),
  );
});

export type { ClientBoundMessage, WorkerBoundMessage };
```

`event.source` is the client that sent the message; `clients.matchAll` reaches every open tab.

---

## Pattern 11: Aggressive update

Take over immediately. This changes behaviour under an open session, so keep it for security fixes
and breaking changes.

```typescript
const CACHE_VERSION = "v2.0.0";

self.addEventListener("install", (event: ExtendableEvent) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(`static-${CACHE_VERSION}`);
      await cache.addAll(PRECACHE_URLS);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event: ExtendableEvent) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames
          .filter((name) => name !== `static-${CACHE_VERSION}`)
          .map((name) => caches.delete(name)),
      );

      await self.clients.claim();

      const clients = await self.clients.matchAll({ type: "window" });
      for (const client of clients) {
        client.postMessage({ type: "FORCE_RELOAD" });
      }
    })(),
  );
});
```

---

## Pattern 12: Deferred update, user-triggered

The default. Remembering dismissed versions stops the banner returning on every page load.

```typescript
interface UpdateHandler {
  checkForUpdates: () => Promise<boolean>;
  applyUpdate: () => void;
  dismissUpdate: () => void;
}

function createUpdateHandler(
  onUpdateAvailable: (version: string) => void,
): UpdateHandler {
  let waitingWorker: ServiceWorker | null = null;
  let dismissedVersions = new Set<string>();

  const storedDismissed = localStorage.getItem("sw-dismissed-versions");
  if (storedDismissed) {
    dismissedVersions = new Set(JSON.parse(storedDismissed));
  }

  const saveDismissed = () => {
    localStorage.setItem(
      "sw-dismissed-versions",
      JSON.stringify([...dismissedVersions]),
    );
  };

  navigator.serviceWorker.addEventListener("message", (event: MessageEvent) => {
    const isNewVersion =
      event.data?.type === "VERSION" &&
      !dismissedVersions.has(event.data.version);
    if (isNewVersion) onUpdateAvailable(event.data.version);
  });

  return {
    async checkForUpdates(): Promise<boolean> {
      const registration = await navigator.serviceWorker.ready;

      if (registration.waiting) {
        waitingWorker = registration.waiting;
        waitingWorker.postMessage({ type: "GET_VERSION" });
        return true;
      }

      await registration.update();
      return !!registration.waiting;
    },

    applyUpdate(): void {
      waitingWorker?.postMessage({ type: "SKIP_WAITING" });
    },

    dismissUpdate(): void {
      if (!waitingWorker) return;

      // ask for the version so the dismissal can be recorded against it
      waitingWorker.postMessage({ type: "GET_VERSION" });

      const handler = (event: MessageEvent) => {
        if (event.data?.type !== "VERSION") return;
        dismissedVersions.add(event.data.version);
        saveDismissed();
        navigator.serviceWorker.removeEventListener("message", handler);
      };

      navigator.serviceWorker.addEventListener("message", handler);
    },
  };
}

export { createUpdateHandler };
export type { UpdateHandler };
```

Nothing here touches the DOM, so the same handler drives any UI.

---

## Pattern 13: Update at idle

Automatic, but not mid-interaction. The max-wait timer stops a user who never goes idle from never
getting the update.

```typescript
const IDLE_TIMEOUT_MS = 30_000;
const MAX_IDLE_WAIT_MS = 300_000;

async function applyUpdateWhenIdle(
  registration: ServiceWorkerRegistration,
): Promise<void> {
  if (!registration.waiting) return;

  return new Promise((resolve) => {
    let idleCallback: number | null = null;
    let maxWaitTimeout: ReturnType<typeof setTimeout> | null = null;

    const applyUpdate = () => {
      if (idleCallback !== null) cancelIdleCallback(idleCallback);
      if (maxWaitTimeout !== null) clearTimeout(maxWaitTimeout);

      registration.waiting?.postMessage({ type: "SKIP_WAITING" });
      resolve();
    };

    if ("requestIdleCallback" in window) {
      const scheduleIdleCheck = () => {
        idleCallback = requestIdleCallback(() => applyUpdate(), {
          timeout: IDLE_TIMEOUT_MS,
        });
      };

      scheduleIdleCheck();

      const activityEvents = ["mousedown", "keydown", "touchstart", "scroll"];
      const onActivity = () => {
        if (idleCallback !== null) cancelIdleCallback(idleCallback);
        scheduleIdleCheck();
      };

      activityEvents.forEach((event) => {
        window.addEventListener(event, onActivity, { passive: true });
      });
    }

    maxWaitTimeout = setTimeout(applyUpdate, MAX_IDLE_WAIT_MS);
  });
}

export { applyUpdateWhenIdle };
```

---

## Pattern 14: Progressive rollout

Bucket each client once and persist it, so a user does not flip between versions on reload.

```typescript
const ROLLOUT_STORAGE_KEY = "sw-rollout-bucket";
const BUCKET_COUNT = 100;

interface RolloutConfig {
  targetPercentage: number;
  featureFlagEndpoint?: string;
}

function getUserBucket(): number {
  const stored = localStorage.getItem(ROLLOUT_STORAGE_KEY);
  if (stored !== null) return parseInt(stored, 10);

  const bucket = Math.floor(Math.random() * BUCKET_COUNT);
  localStorage.setItem(ROLLOUT_STORAGE_KEY, bucket.toString());
  return bucket;
}

async function shouldApplyUpdate(config: RolloutConfig): Promise<boolean> {
  const bucket = getUserBucket();

  if (config.featureFlagEndpoint) {
    try {
      const response = await fetch(config.featureFlagEndpoint);
      const data = await response.json();
      if (typeof data.targetPercentage === "number") {
        return bucket < data.targetPercentage;
      }
    } catch {
      // remote config unreachable — fall through to the local percentage
    }
  }

  return bucket < config.targetPercentage;
}

async function conditionalUpdate(
  registration: ServiceWorkerRegistration,
  config: RolloutConfig,
): Promise<boolean> {
  if (!registration.waiting) return false;

  const shouldUpdate = await shouldApplyUpdate(config);
  if (!shouldUpdate) return false;

  registration.waiting.postMessage({ type: "SKIP_WAITING" });
  return true;
}

export { conditionalUpdate, getUserBucket, shouldApplyUpdate };
export type { RolloutConfig };
```

---

## Pattern 15: Update with cache migration

When the shape of cached data changes, transform it before the old caches are deleted. The previous
version is recoverable from the cache names themselves.

```typescript
declare const self: ServiceWorkerGlobalScope;

const CACHE_VERSION = "v2.0.0";

interface MigrationTask {
  fromVersion: string;
  toVersion: string;
  migrate: () => Promise<void>;
}

const MIGRATIONS: MigrationTask[] = [
  {
    fromVersion: "v1.0.0",
    toVersion: "v2.0.0",
    async migrate() {
      const oldCache = await caches.open("api-v1.0.0");
      const newCache = await caches.open(`api-${CACHE_VERSION}`);

      for (const request of await oldCache.keys()) {
        const response = await oldCache.match(request);
        if (!response) continue;

        const transformed = transformData(await response.json());
        await newCache.put(
          request,
          new Response(JSON.stringify(transformed), {
            headers: response.headers,
          }),
        );
      }
    },
  },
];

function transformData(data: unknown): unknown {
  return data;
}

async function runMigrations(fromVersion: string): Promise<void> {
  const applicable = MIGRATIONS.filter(
    (m) => m.fromVersion === fromVersion && m.toVersion === CACHE_VERSION,
  );

  for (const migration of applicable) {
    await migration.migrate();
  }
}

self.addEventListener("activate", (event: ExtendableEvent) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();
      const previousStaticCache = cacheNames.find(
        (name) =>
          name.startsWith("static-") && name !== `static-${CACHE_VERSION}`,
      );

      if (previousStaticCache) {
        await runMigrations(previousStaticCache.replace("static-", ""));
      }

      // deletion comes last, so a failed migration leaves the old data intact
      await Promise.all(
        cacheNames
          .filter((name) => !name.includes(CACHE_VERSION))
          .map((name) => caches.delete(name)),
      );

      await self.clients.claim();
    })(),
  );
});
```

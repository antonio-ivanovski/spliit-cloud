# Service Worker Reference

> Lookup tables and selection guides. Concepts and red flags are in [SKILL.md](SKILL.md); code is in
> [examples/](examples/).

---

## Strategy by content type

| Content type              | Strategy               | Why                             |
| ------------------------- | ---------------------- | ------------------------------- |
| HTML pages                | Network-first          | Users expect fresh content      |
| Static assets (hashed)    | Cache-first            | The hash guarantees freshness   |
| Static assets (unhashed)  | Stale-while-revalidate | Speed now, freshness next visit |
| Images                    | Cache-first with limit | Speed, bounded growth           |
| API responses (read)      | Stale-while-revalidate | Speed with background refresh   |
| API responses (user data) | Network-first          | Freshness matters               |
| Real-time data            | Network-only           | Must always be current          |
| Fonts                     | Cache-first            | Rarely change                   |

---

## Choosing an update strategy

```
How should a waiting worker be applied?
├─ Critical security fix?
│   └─ Aggressive — skipWaiting in install (updates.md Pattern 11)
├─ Cached data needs transforming for the new version?
│   └─ Migration-aware activate (updates.md Pattern 15)
├─ Disruption matters most?
│   └─ Deferred, user-triggered (updates.md Pattern 12)
├─ Automatic but unobtrusive?
│   └─ Apply at idle with a max wait (updates.md Pattern 13)
└─ Rolling out gradually?
    └─ Persistent bucketing (updates.md Pattern 14)
```

---

## Lifecycle events

| Event      | Fires when                      | Used for                            |
| ---------- | ------------------------------- | ----------------------------------- |
| `install`  | A new worker is downloaded      | Precaching                          |
| `activate` | It takes control, after waiting | Cache cleanup, enabling nav preload |
| `fetch`    | Any request in scope            | Serving from cache or network       |
| `message`  | A client posts a message        | Skip-waiting, version queries       |
| `push`     | A push message arrives          | Showing a notification              |
| `sync`     | Background sync fires           | Retrying deferred work              |

## Registration states

| State        | Meaning                            | Intercepts fetch? |
| ------------ | ---------------------------------- | ----------------- |
| `installing` | Running the install handler        | No                |
| `installed`  | Installed, waiting for old clients | No                |
| `activating` | Running the activate handler       | No                |
| `activated`  | In control                         | Yes               |
| `redundant`  | Replaced or failed                 | No                |

## Cache API

| Method                         | Does                      |
| ------------------------------ | ------------------------- |
| `caches.open(name)`            | Open or create a cache    |
| `caches.delete(name)`          | Delete a cache            |
| `caches.keys()`                | List cache names          |
| `caches.match(request)`        | Search every cache        |
| `cache.add(url)`               | Fetch and store one URL   |
| `cache.addAll(urls)`           | Fetch and store many      |
| `cache.put(request, response)` | Store a response you hold |
| `cache.match(request)`         | Look up in one cache      |
| `cache.delete(request)`        | Remove one entry          |
| `cache.keys()`                 | List stored requests      |

## Navigation preload

| Member                                                 | Does                                                 |
| ------------------------------------------------------ | ---------------------------------------------------- |
| `registration.navigationPreload.enable()`              | Start preloading navigations                         |
| `registration.navigationPreload.disable()`             | Stop preloading                                      |
| `registration.navigationPreload.setHeaderValue(value)` | Set the `Service-Worker-Navigation-Preload` header   |
| `event.preloadResponse`                                | Promise for the preloaded `Response`, or `undefined` |

---

## Review checklist

Items a red flag does not already cover.

- [ ] Registration is guarded by `"serviceWorker" in navigator`
- [ ] Registration failure is caught, and the app still works without a worker
- [ ] Scope is deliberate, and the script sits at the root it needs to control
- [ ] An update check runs on an interval, not only at first load
- [ ] `controllerchange` reloads once, guarded against a reload loop
- [ ] Authenticated and personalised responses are kept out of shared caches
- [ ] Requests needing credentials are issued with the right `credentials` mode

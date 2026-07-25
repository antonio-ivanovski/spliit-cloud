# Managed hosting (PaaS) options

Notes for running Spliit Cloud without owning a VPS. The goal is a set-and-forget deployment for a
small instance (a handful of users), cheap, and with as little divergence from upstream as possible.

**Option A was chosen.** This page is kept as the reasoning and the comparison; the runbook is
[Deploying to Cloudflare Pages + Fly.io](./deploy-fly.md).

For the container/compose basics see [Deployment](./deployment.md).

## What actually has to be hosted

| Piece         | Shape                                       | Hosting need                                  |
| ------------- | ------------------------------------------- | --------------------------------------------- |
| `apps/web`    | Vite SPA + PWA, static `dist/`              | Any static host (CDN)                         |
| `apps/api`    | Hono app on `Bun.serve`, port `3001`        | Long-lived HTTP process                       |
| `apps/worker` | `pg-boss` job supervisor, admin port `3003` | **Long-lived process — cannot be serverless** |
| Postgres      | Prisma 7 over `@prisma/adapter-pg` (TCP)    | Managed Postgres                              |
| SMTP          | `nodemailer` (raw TCP)                      | Any SMTP provider                             |
| Documents     | Presigned S3 (`@aws-sdk/client-s3`)         | S3-compatible bucket (R2 works)               |

`apps/worker` is the constraint that decides everything. It holds a Postgres pool with
`LISTEN/NOTIFY`, runs `pg-boss` with `supervise: true` and `pollingIntervalSeconds: 1`, and registers
an every-minute reconciliation cron (`JOBS_RECONCILIATION_CRON`, default `* * * * *`). It is not a
request-triggered design, so a serverless function cannot host it without a rewrite. It does not,
however, have to be its own service — see [Do you need the worker?](#do-you-need-the-worker) below.

Two more things worth knowing before comparing platforms:

- The API enqueues jobs **inside** the Prisma transaction that writes the expense
  (`packages/jobs/src/boss.ts`, `fromPrisma(tx)`). Replacing `pg-boss` with any external queue loses
  that atomicity and needs an outbox table.
- Bulk categorization allows itself ~245 s (`apps/api/src/lib/ai/categorize.ts`), which exceeds
  Cloudflare's edge timeout and the function ceiling on cheaper Vercel tiers.

Already portable, no work needed: the SPA, presigned uploads (R2-ready — `container.env.example`
already documents the R2 shape), and Prisma, which uses driver adapters rather than the Rust engine.

## Do you need the worker?

Worth answering before picking a platform, because it decides whether you pay for one always-on
service or two.

The worker serves exactly one feature: **recurring expenses**. Two queues
(`packages/jobs/src/registry.ts`):

- `recurring-expense.materialize` — creates the expense row for one occurrence, enqueues the next
  one, and fires the "recurring expense created" notification. Chain-driven, so each occurrence
  schedules its successor.
- `recurring-expense.reconcile` — a cron-driven safety net that scans for series whose
  `nextOccurrenceDate` has passed and re-enqueues anything the chain dropped. Also resumes series
  when an archived group is restored.

Nothing else runs there. Ordinary expense notifications are dispatched from the API process itself
(`apps/api/src/lib/notifications/schedule.ts`), not through pg-boss.

Two details that matter:

- **The work is day-granular.** `recurrenceJobStartAfter` (`apps/api/src/lib/api/recurrence/template.ts`)
  pins every job to 00:05 UTC on its occurrence date. The per-minute reconcile cron is belt-and-braces,
  not the mechanism — hourly behaves identically from a user's point of view.
- **Turning jobs off is a supported state**, not a hack. With `JOBS_ENABLED=false` the worker serves
  a "disabled" health endpoint and `enqueueMaterialization` returns early.

### Three ways to size it

**Inline (recommended for small instances).** Set `JOBS_INLINE=true` on the API and do not deploy the
worker container. The API process — already long-lived, already holding a pg-boss client for
transactional enqueues — registers the same handlers and the same reconciliation schedule. No
behaviour change, one service instead of two. Do not enable it while a standalone worker is also
running, or both will schedule reconciliation.

**Two services.** The default. Independent scaling, and you can restart the API without pausing job
execution. Worth it when job volume grows enough to compete with request serving; at a handful of
users it is not.

**Jobs off.** `JOBS_ENABLED=false`, no worker, no inline runner. Recurring expenses stop
materializing; everything else works. Check whether anyone actually uses the feature first:

```sql
select status, count(*) from "RecurringExpenseSeries" group by status;
```

No rows, or none `ACTIVE`, means the worker is currently doing nothing at all.

Independently of which you pick, consider relaxing the cron:

```sh
JOBS_RECONCILIATION_CRON=0 * * * *   # hourly
```

The per-minute default keeps a query hitting Postgres around the clock, which is exactly what
exhausts a usage-metered database plan.

### Effect on hosting cost

| Setup                       | Fly    | Railway                              | Render |
| --------------------------- | ------ | ------------------------------------ | ------ |
| Two services                | ~$5.15 | two services                         | $14    |
| Inline (`JOBS_INLINE=true`) | ~$3.20 | one service, inside the Hobby credit | $7     |
| Jobs off                    | ~$3.20 | one service                          | $7     |

It does **not** change which platforms are viable. Cloudflare Workers and Vercel are still ruled out
by `nodemailer`, `web-push`, and the ~245 s bulk-categorize handler — removing the worker is the
smallest of those blockers, so doing it alone unlocks nothing.

## Options

| #     | Option                             | Web                   | API + worker                                        | Code change                 | ~$/month     |
| ----- | ---------------------------------- | --------------------- | --------------------------------------------------- | --------------------------- | ------------ |
| **A** | **Cloudflare Pages + Fly.io**      | CF Pages              | 1–2 Fly apps from the existing `Dockerfile` targets | none                        | **~3–5**     |
| B     | Cloudflare Pages + Railway         | CF Pages              | 1–2 Railway services from the GHCR images           | one CI line                 | ~5–10        |
| C     | All-Cloudflare (Containers)        | Workers static assets | Containers behind a wrapper Worker                  | new Worker + Durable Object | ~7–12        |
| D     | All-Vercel                         | Vercel                | `hono/vercel` function + Vercel Cron                | medium                      | 0–20         |
| E     | All-Cloudflare (full Workers port) | Workers static assets | Worker + Queues + Cron + Hyperdrive                 | large                       | ~5           |
| F     | Cloudflare Pages + Render / Koyeb  | CF Pages              | 2 services                                          | none–small                  | ~14 (Render) |

### A — Cloudflare Pages + Fly.io

Fly apps built straight from the existing multi-stage `Dockerfile`, which already has `api`,
`worker`, and `migrate` targets. Fly's `[build] build-target` picks the stage, so no application code
changes. One app with `JOBS_INLINE=true`, or two if you want the worker separate.

**Pros**

- No application rewrite. `nodemailer`, `web-push`, `pg-boss`, and the 245 s AI handler all keep
  working exactly as they do today.
- Fully managed machines. No OS, no reverse proxy, no Docker host to patch.
- Remote builder handles the image build, so no local Docker and no architecture mismatch.
- Cheapest of the no-rewrite options, especially with jobs inline.

**Cons**

- CLI-first. Less hand-holding than Railway's UI.
- No free tier for new organizations.
- Something has to stay running for jobs to materialize, so scale-to-zero is off the table unless you
  disable jobs entirely.
- A third vendor in the stack alongside Cloudflare.

### B — Cloudflare Pages + Railway

Same shape as A, but Railway has the friendliest UI and push-to-deploy from GitHub.

**Pros**

- Least "infrastructure" feeling of any option. Connect the repo, set env vars, done.
- Can also host Postgres if you would rather not add a database vendor.

**Cons**

- No native support for selecting a `Dockerfile` build target, so the practical route is deploying
  the images CI already publishes to GHCR. Those are built `linux/arm64` only
  (`.github/workflows/deploy.yml`), so the build matrix needs `linux/amd64` added — a one-line
  change, but it does touch a tracked file.
- Usage-based billing is easy to misjudge; two always-on services on the Hobby plan sit near the
  included credit.

### C — All-Cloudflare via Containers

Keeps everything on one platform. Cloudflare Containers can run the same images.

**Pros**

- Single vendor, single dashboard, single bill.
- No application code change.

**Cons**

- Not set-and-forget. Containers require a wrapper Worker plus a container-enabled Durable Object
  class declared in `wrangler.jsonc` (`containers`, `durable_objects`, `migrations`). That is new
  code to write and maintain for no functional gain over A or B.
- Images must be `linux/amd64`.
- Billing is per-10ms-active. The $5 Workers Paid plan includes 25 GiB-hours of memory and
  200 GB-hours of disk; a single always-on `lite` instance (256 MiB, 2 GB disk) needs roughly
  182 GiB-hours and 1460 GB-hours, so budget about $2 per always-on service on top of the base $5.
- The worker cannot usefully sleep, which is the case Containers are least suited to.

### D — All-Vercel

The SPA deploys trivially. The Hono app ports to a Vercel Function via `hono/vercel`, and because
that runs on Node, `nodemailer`, `web-push`, and `pg` all work.

**Pros**

- Excellent DX, preview deployments, one vendor for web + API.

**Cons**

- `apps/worker` cannot run. You must add an HTTP route that drains the `pg-boss` queue and drive it
  from Vercel Cron — new code, and it gives up the current sub-second job latency.
- Hobby cron fires **once per day**, versus the current every-minute reconcile, so minute-level
  scheduling means Pro at $20/month. Hobby also disallows commercial use.
- The 245 s bulk-categorize handler exceeds the Hobby function ceiling.
- `NODE_ENV` must be set explicitly. `apps/api/src/lib/auth/index.ts` gates `useSecureCookies` and
  the secure cookie attributes on it, and outside the `Dockerfile` nothing sets it.

### E — All-Cloudflare, full Workers port

Technically the cheapest and fastest, and the API is closer than you would expect: it is a Hono app
already built on Web `Request`/`Response`, with no WebSockets, no streaming, and WebCrypto rather
than Node crypto in most places.

**But it requires**, at minimum: replacing `nodemailer` with an HTTP mail API; replacing `web-push`
with a WebCrypto VAPID implementation; replacing `pg-boss` with Queues plus Cron Triggers and adding
an outbox table to recover transactional enqueue; adding Hyperdrive for the Postgres connection;
wrapping the fire-and-forget dispatch in `apps/api/src/lib/notifications/schedule.ts` in
`ctx.waitUntil()`; moving bulk categorization behind a queue; replacing the in-memory rate limiter in
`importPreview.procedure.ts` with a durable one; inlining `openapi.json` instead of reading it from
disk; and setting `NODE_ENV` explicitly.

That is a permanent fork from upstream. **Not recommended** for a five-user instance.

### F — Render, Koyeb, Northflank

Equivalent to A and B in shape. Render is the notable one: nice blueprint-as-code (`render.yaml`),
but the free tier spins services down — fatal for the worker — and paid instances are $7 each, so
$14/month for two. Koyeb and Northflank are cheaper but less established.

## Recommendation: Option A

Cloudflare Pages for the SPA (where it already is), Fly.io for the API and worker, Supabase for
Postgres, an SMTP provider for mail, R2 for documents.

### 1. Postgres — prefer Supabase over Neon

Non-obvious but important: `pg-boss` polls every second and runs a per-minute cron, so the database
is **never idle**. Neon's free tier meters compute-hours (~191/month) and an always-on connection
consumes ~730, so it will be exhausted. Supabase's free tier is not compute-hour metered.

Use the **direct connection on port 5432 (session mode)** for `apps/worker` — `pg-boss` needs
`LISTEN/NOTIFY`, which the transaction pooler does not support. The API can use either.

If you prefer Neon: use a paid plan, or raise `JOBS_RECONCILIATION_CRON` and accept slower
recurring-expense materialization.

### 2. SMTP — Resend, Brevo, or SES via their SMTP endpoint

All of them expose plain SMTP, so `nodemailer` and every template under
`apps/api/src/lib/mail/templates` stay untouched. Only `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
`SMTP_PASS`, and `EMAIL_FROM` change. Set up SPF/DKIM/DMARC for the `EMAIL_FROM` domain.

### 3. Documents — Cloudflare R2

`apps/api/src/routes/upload.ts` sets `forcePathStyle` whenever `S3_UPLOAD_ENDPOINT` is present, so
R2 works unchanged. `container.env.example` already carries the R2 defaults
(`S3_UPLOAD_REGION=auto`, `https://<account-id>.r2.cloudflarestorage.com`).

### 4. Fly config

This is committed as [`fly.api.toml`](../fly.api.toml) at the repo root — it has to live there,
because the `Dockerfile` runs `turbo prune` and needs the repo root as its build context, and Fly
derives the context from the directory holding the config file.

One app, with `JOBS_INLINE = "true"` so the job runner shares the API process. That is what forces
`min_machines_running = 1`: a suspended machine materializes nothing.

Two details in that file are load-bearing and easy to lose in an edit:

- **`[build.args] APP_SCOPE`** — the `Dockerfile`'s pruner stage runs `test -n "$APP_SCOPE"` and fails
  the build without it.
- **`kill_timeout = 40`** — the API drains pg-boss on `SIGTERM` and `stopBoss` allows the in-flight
  job 30 s. Fly's 5 s default would cut that short and leave the job to be retried.

The runner stage already sets `ENV NODE_ENV=production`, so the secure-cookie gating in
`apps/api/src/lib/auth/index.ts` is satisfied with no extra configuration. That is only a concern on
options D and E, which do not use the `Dockerfile`.

### 5. Migrations

Handled by `[deploy] release_command` in `fly.api.toml`, which runs `prisma migrate deploy` in a
temporary machine before any traffic shifts. Replaces the compose `migrate` service.

### 6. Wiring the origins

- Cloudflare Pages build: `VITE_API_URL` = the API origin (`https://spliit-api.fly.dev` or a custom
  domain).
- API: `WEB_ORIGINS` must list the Pages origin, and `BETTER_AUTH_URL` must be the API's own public
  origin. Both are already documented in `container.env.example`.

### 7. Secrets

Set everything else with `fly secrets set`. `container.env.example` is the canonical annotated list —
treat it as the checklist rather than duplicating forty variables here. The values that must not be
missed in production: `BETTER_AUTH_SECRET`, `DATABASE_URL`, `SMTP_HOST`, `EMAIL_FROM`,
`EMAIL_UNSUBSCRIBE_SECRET`, and all three `PUSH_VAPID_*` together.

### 8. Retiring the VPS

Once traffic is on Fly, drop the Dokploy deploy step (`POST /api/compose.deploy`) from
`.github/workflows/deploy.yml` and stop using `compose.dokploy.yaml`. Continuous deploys are handled
by `.github/workflows/fly-deploy.yml` instead. Publishing images to GHCR can stay — it is harmless —
or go, since Fly builds from source rather than from those images.

### Step-by-step

The above is the shape; [Deploying to Cloudflare Pages + Fly.io](./deploy-fly.md) is the actual
runbook — prerequisites, the exact commands, what the Fly web UI can and cannot do, and
troubleshooting.

## Cost sketch (small instance)

| Item                                                      | Cost            |
| --------------------------------------------------------- | --------------- |
| Fly API — `shared-cpu-1x`, 512 MB, always on, jobs inline | ~$3.20          |
| Supabase Postgres — free tier                             | $0              |
| Resend — free tier (3k emails/month)                      | $0              |
| Cloudflare R2 — free tier (10 GB)                         | $0              |
| Cloudflare Pages                                          | $0              |
| **Total**                                                 | **~$3–4/month** |

Add ~$1.95 for a separate `shared-cpu-1x` 256 MB worker if you keep the two-service layout.

## Divergence from upstream

| Change                                                                                   | Conflict risk |
| ---------------------------------------------------------------------------------------- | ------------- |
| New: `fly.api.toml`, `docs/hosting-paas.md`, `docs/deploy-fly.md`                        | none          |
| New: `.github/workflows/fly-deploy.yml`                                                  | none          |
| New: `apps/api/src/lib/jobs/` (inline runner + handlers)                                 | none          |
| Modified: `apps/api/src/server.ts`, `apps/worker/src/handlers.ts` (`JOBS_INLINE` wiring) | small         |
| Modified: `packages/jobs/src/env.ts`, `container.env.example` (one flag each)            | small         |
| Modified: `.github/workflows/deploy.yml` (drop the Dokploy step)                         | small         |
| Unchanged: `Dockerfile`, `docs/deployment.md`, all recurrence/business logic             | —             |

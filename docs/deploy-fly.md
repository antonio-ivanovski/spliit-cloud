# Deploying to Cloudflare Pages + Fly.io

End-to-end setup for a small managed deployment: the SPA on Cloudflare Pages, the API (with background
jobs running inside it) on Fly.io, Postgres on Supabase, mail through an SMTP provider, and documents
in Cloudflare R2. No VPS, no Docker host to patch.

For why this shape was chosen over the alternatives, see [Managed hosting options](./hosting-paas.md).

Config lives in [`fly.api.toml`](../fly.api.toml) at the repo root. Continuous deploys use
[`.github/workflows/fly-deploy.yml`](../.github/workflows/fly-deploy.yml).

## How much of this can be done in the Fly web UI?

Be aware of the split before you start:

| Task                            | Web UI                         | CLI                         |
| ------------------------------- | ------------------------------ | --------------------------- |
| Create the app, first deploy    | ✗                              | `fly launch` / `fly deploy` |
| Redeploy after a code change    | ✗ (use GitHub Actions instead) | `fly deploy`                |
| Set and update secrets          | ✓                              | `fly secrets set`           |
| Scale memory / machine count    | ✓                              | `fly scale`                 |
| Logs, metrics, machine status   | ✓                              | `fly logs`, `fly status`    |
| Custom domain + TLS certificate | ✓                              | `fly certs add`             |
| Delete or restart machines      | ✓                              | `fly machine ...`           |

The dashboard cannot build a Dockerfile, so **the first deploy has to come from `flyctl`.** After that
you never need to touch the CLI again: step 8 wires up GitHub Actions so every merge to `main`
deploys itself, and everything else is dashboard work.

---

## Before you start

Work through these first. Each produces a value you will paste into Fly secrets in Step 3.

### 1. Domain layout

Worked example uses `davidstepanov.com`; substitute your own. The convention is a **flat pair per
app**, both one level below the apex:

| Host                           | Serves                                              |
| ------------------------------ | --------------------------------------------------- |
| `spliit.davidstepanov.com`     | the SPA, on Cloudflare Pages                        |
| `spliit-api.davidstepanov.com` | the API, on Fly                                     |
| `send.davidstepanov.com`       | outbound mail, verified in Resend once for all apps |

Adding another app later means another pair: `budget.davidstepanov.com` +
`budget-api.davidstepanov.com`, reusing the same sending subdomain.

**Why flat rather than `api.spliit.davidstepanov.com`.** Cloudflare's free Universal SSL covers the
apex and first-level subdomains only. A nested `api.spliit.…` is two levels deep and falls outside
it, leaving you to either turn off the Cloudflare proxy for that host or buy Total TLS / Advanced
Certificate Manager — around $10/month per zone, several times the cost of the hosting itself. The
flat pair keeps every host on the free certificate and behind the proxy.

Cookies are unaffected by the choice: both hosts are same-site under the apex, and the API already
sets `sameSite: 'lax'` with credentialed CORS.

### 2. Postgres — Supabase

1. Create a project at [supabase.com](https://supabase.com). Pick a region near your Fly region.
2. Set a strong database password when prompted; you cannot read it back later.
3. **Project Settings → Database → Connection string → URI.** Take the **direct connection on port
   5432**, not the pooler on 6543.

Why the direct connection: `pg-boss` uses `LISTEN/NOTIFY`, which needs a session-mode connection.
The transaction pooler will silently fail to deliver job notifications.

> **Not Neon.** The job runner keeps a connection open permanently, so the database is never idle and
> Neon's free compute-hour allowance is consumed within days. Supabase's free tier is not metered
> that way. See [hosting-paas.md](./hosting-paas.md#do-you-need-the-worker) for the detail.

Keep the URI as `DATABASE_URL`.

#### Project options: turn all three off

Supabase offers these at project creation. This app uses Supabase as a plain Postgres server —
Prisma connects directly over TCP, and there is no `supabase-js` anywhere in the repo — so none of
them are in the request path.

| Option                          | Set to  | Why                                                                                                              |
| ------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------- |
| Enable Data API                 | **off** | Publishes a PostgREST API over the `public` schema at `https://<project>.supabase.co/rest/v1/`. Nothing calls it |
| Automatically expose new tables | **off** | Only meaningful with the Data API on; this is what would auto-publish each table a migration creates             |
| Enable automatic RLS            | **off** | Exists to constrain the Data API's roles. With no Data API there is nothing to constrain                         |

The Data API is the one that matters. Prisma has no `schemas` configured, so every model lands in
`public` — including `Session`, `Account`, `AuthIdentity`, and `Verification`, which hold session
tokens, OAuth identities, and email-verification tokens. Leaving the Data API on puts an
internet-facing HTTP surface in front of those for no benefit. With it off, the only way in is a
direct Postgres connection with credentials.

Row Level Security buys nothing here either: the sole client connects as `postgres`, which owns the
tables and bypasses RLS regardless. Automatic RLS also installs an event trigger that fires on every
`CREATE TABLE`, so it adds a small failure mode to `prisma migrate deploy` in exchange for nothing.

Authorization is enforced in the API layer — better-auth sessions plus the tRPC procedures — not in
the database.

#### Lock down network access

The direct connection is reachable from the public internet by default, so **the database password is
the only thing protecting it.** Use a long random one, and rotate it if it was ever pasted somewhere
it should not have been.

IP allowlisting is not a practical second layer here without paying extra. A Fly Machine's outbound
address is dynamic by default and "liable to change without notice", so there is no stable range to
allowlist. A static egress IP has to be allocated per machine and is billed monthly:

```sh
fly machine egress-ip allocate <machine-id>
```

Worth it if you want Supabase's network restrictions to mean something; otherwise treat the password
as the control and keep it out of shell history and source control.

### 3. Mail — Resend (or Brevo, Mailgun, SES)

Any provider with an SMTP endpoint works, and the app keeps using `nodemailer` unchanged.

1. Create an account and add **`send.davidstepanov.com`** as the domain — a sending subdomain, not
   the apex.
2. Add the DNS records it gives you in Cloudflare, and a `_dmarc` TXT record at the apex starting at
   `p=none`. Skipping SPF/DKIM means magic-link sign-in emails land in spam, which makes the app
   unusable.
3. Create SMTP credentials.

Keep: `SMTP_HOST`, `SMTP_PORT` (587), `SMTP_USER`, `SMTP_PASS`, and `EMAIL_FROM` formatted as
`"Spliit <spliit@send.davidstepanov.com>"`.

**Why a subdomain rather than the apex.** It isolates the app's sending reputation from your personal
mail, and it avoids an SPF collision: a domain may have only one SPF record, so if the apex already
sends mail (Google Workspace, Fastmail, …) adding a provider there means hand-merging includes, and
two SPF records silently break delivery for both. One verified sending subdomain also serves every
future app — `spliit@send.…`, `budget@send.…` — from a single verification.

Resend's records are TXT and MX, which Cloudflare does not proxy, so there is nothing to grey-cloud.
If a provider hands you a CNAME, set that record to **DNS only**. Note that subdomains inherit the
apex DMARC policy unless you set `sp=`.

### 4. Documents — Cloudflare R2 (only if you want file uploads)

Skip this and leave `PUBLIC_ENABLE_EXPENSE_DOCUMENTS=false` if you do not need receipt attachments.

1. **Cloudflare dashboard → R2 → Create bucket.**
2. Enable a public r2.dev URL, or connect a custom domain, so uploaded documents are readable.
3. **Manage R2 API Tokens → Create API token**, with Object Read & Write on that bucket.

Keep: `S3_UPLOAD_KEY`, `S3_UPLOAD_SECRET`, `S3_UPLOAD_BUCKET`, `S3_UPLOAD_REGION=auto`,
`S3_UPLOAD_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com`, and `S3_UPLOAD_PUBLIC_URL`.

### 5. Generate the secrets

```sh
openssl rand -base64 32          # BETTER_AUTH_SECRET
openssl rand -hex 32             # EMAIL_UNSUBSCRIBE_SECRET (must be >= 32 bytes)
bunx web-push generate-vapid-keys # PUSH_VAPID_PUBLIC_KEY / PUSH_VAPID_PRIVATE_KEY
```

`PUSH_VAPID_SUBJECT` is a contact URL, e.g. `mailto:admin@davidstepanov.com`. All three `PUSH_VAPID_*`
values are all-or-nothing — set every one or none, or the API refuses to start.

### 6. Accounts and tooling

- A Fly.io account with a payment method (no free tier for new organizations; expect ~$3–4/month).
- A Cloudflare account, with `davidstepanov.com` already on it as a zone.
- `flyctl`: `brew install flyctl`, then `fly auth login`.

`container.env.example` is the annotated master list of every variable, including the optional AI and
OAuth ones this guide does not cover.

---

## Deploy the API to Fly

### Step 1 — Pick a name and region

Edit `fly.api.toml`:

```toml
app = "spliit-api"    # must be globally unique across Fly
primary_region = "fra" # match your Supabase region; `fly platform regions` lists them
```

### Step 2 — Create the app without deploying

```sh
fly apps create spliit-api
```

Use `fly launch` only if you want it to generate a config — it will overwrite `fly.api.toml`.

### Step 3 — Set the secrets

`--stage` writes them without triggering a deploy, which matters because there is no image yet.

```sh
fly secrets set -a spliit-api --stage \
  DATABASE_URL='postgresql://postgres:PASSWORD@db.PROJECT.supabase.co:5432/postgres' \
  BETTER_AUTH_SECRET='...' \
  BETTER_AUTH_URL='https://spliit-api.davidstepanov.com' \
  WEB_ORIGINS='https://spliit.davidstepanov.com' \
  SMTP_HOST='smtp.resend.com' \
  SMTP_PORT='587' \
  SMTP_USER='resend' \
  SMTP_PASS='...' \
  EMAIL_FROM='Spliit <spliit@send.davidstepanov.com>' \
  EMAIL_UNSUBSCRIBE_SECRET='...' \
  PUSH_VAPID_PUBLIC_KEY='...' \
  PUSH_VAPID_PRIVATE_KEY='...' \
  PUSH_VAPID_SUBJECT='mailto:admin@davidstepanov.com'
```

These are the final custom-domain values, set before the domains actually resolve. That is fine —
they are only configuration strings, and the API boots regardless. They start mattering once real
users hit it, which is after Steps 6 and 7 attach the domains.

Add the R2 values plus `PUBLIC_ENABLE_EXPENSE_DOCUMENTS=true` here too if you did prerequisite 4.

Secrets are also editable later in the dashboard under **your app → Secrets**.

### Step 4 — First deploy

```sh
fly deploy -c fly.api.toml --remote-only
```

`--remote-only` builds on Fly's builder, so you do not need Docker locally and the architecture
always matches. The first build takes a few minutes.

The `[deploy] release_command` in the config runs `prisma migrate deploy` in a temporary machine
before any traffic shifts, so the schema is created on this first deploy. If migrations fail, the
deploy aborts and the old version keeps serving — on a first deploy that means nothing starts, and
the release-command logs tell you why (almost always a bad `DATABASE_URL`).

### Step 5 — Verify

The custom domain is not attached yet, so test against the `.fly.dev` hostname:

```sh
fly status -a spliit-api
curl https://spliit-api.fly.dev/health/readiness   # checks the database too
fly logs -a spliit-api
```

In the logs you should see `Spliit Cloud API listening` and, because jobs run inline,
`{"component":"inline-worker","message":"inline worker started"}`. If that second line is missing,
`JOBS_INLINE` is not reaching the process and recurring expenses will never materialize.

---

## Deploy the web app to Cloudflare Pages

### Step 6 — Create or check the Pages project

If you already have a Pages project — `.github/workflows/deploy.yml` fires a `CF_PAGES_DEPLOY_HOOK_URL`,
so you probably do — skip the creation and just confirm the settings below, especially `VITE_API_URL`,
which has to change from the old API origin to the Fly one.

Otherwise: **Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git**, then select
the repo.

| Setting                | Value                                    |
| ---------------------- | ---------------------------------------- |
| Framework preset       | None                                     |
| Build command          | `bun install && bun run build`           |
| Build output directory | `apps/web/dist`                          |
| Root directory         | `/` (repo root — it is a monorepo build) |

Environment variables:

| Name                         | Value                                  |
| ---------------------------- | -------------------------------------- |
| `VITE_API_URL`               | `https://spliit-api.davidstepanov.com` |
| `VITE_DEFAULT_CURRENCY_CODE` | e.g. `EUR`                             |

Set `VITE_ENABLE_GOOGLE_OAUTH` / `VITE_ENABLE_GITHUB_OAUTH` to `true` only if you also configured the
matching OAuth credentials on the API.

These are baked in at build time, so changing one needs a rebuild, not just a redeploy — and it is
the variable most likely to be stale if you are converting an existing Pages project.

Then **Pages project → Custom domains → Set up a domain** and add `spliit.davidstepanov.com`.
Cloudflare creates the DNS record itself, since the zone is on the same account.

### Step 7 — Attach the API domain

```sh
fly certs add spliit-api.davidstepanov.com -a spliit-api
```

Or the same thing in the dashboard under **your app → Certificates**. It then prints the DNS records
to create in Cloudflare. Three things matter when the zone sits behind Cloudflare's proxy:

- Set the zone's SSL mode to **Full (strict)**. Flexible causes redirect loops.
- Add the **`_fly-ownership` TXT** record Fly gives you. That is what lets it verify ownership
  through the proxy; once verified, HTTP-01 issuance works with the orange cloud left on.
- Both hosts are one level below the apex, so Cloudflare's free Universal SSL covers them and no
  paid certificate is needed.

Check it end to end:

```sh
fly certs show spliit-api.davidstepanov.com -a spliit-api
curl https://spliit-api.davidstepanov.com/health/readiness
```

The secrets from Step 3 already carry these hostnames, so nothing needs changing — but if you edit
them later, remember what each one is for:

- `WEB_ORIGINS` is the CORS allowlist and must match the browser's origin exactly, scheme included.
  It is comma-separated, so list every origin users actually reach.
- `BETTER_AUTH_URL` must be the API's own public origin, or OAuth callbacks and cookies break.

Now sign in. If the magic-link email arrives and the session sticks, both sides are wired correctly.

---

## Step 8 — Continuous deploys

This is what makes it set-and-forget. `.github/workflows/fly-deploy.yml` deploys the API whenever CI
passes on `main`; Cloudflare Pages already rebuilds on push by itself.

```sh
fly tokens create deploy -x 999999h -a spliit-api
```

Copy the token into **GitHub → repo Settings → Secrets and variables → Actions → New repository
secret**, named `FLY_API_TOKEN`.

Test it with **Actions → Deploy API to Fly.io → Run workflow** before relying on it.

### Retiring the old VPS

Once traffic is on Fly and Pages, delete the `deploy-dokploy` job from
`.github/workflows/deploy.yml`. The `build-and-push` job that publishes images to GHCR can stay —
harmless — or go with it, since Fly builds from source rather than from those images.

---

## Optional

### Reusing this for another app

The domain convention is designed to repeat. For a second app on the same apex:

| Host                           | Points at                    |
| ------------------------------ | ---------------------------- |
| `budget.davidstepanov.com`     | its own Pages project        |
| `budget-api.davidstepanov.com` | its own Fly app              |
| `send.davidstepanov.com`       | unchanged — already verified |

Everything one level below the apex stays inside the free Universal SSL certificate, so a new app
costs two DNS records and nothing else. Mail needs no new verification: send from
`budget@send.davidstepanov.com` with the same SMTP credentials.

Keep each app in its own Fly app and its own Supabase project. Sharing a database between apps means
one app's migrations can break another, and Supabase's free tier is per-project anyway.

### Splitting the worker out again

If job volume ever grows enough to compete with request serving, set `JOBS_INLINE = "false"` in
`fly.api.toml` and add a `fly.worker.toml` that is identical except:

```toml
app = "spliit-worker"

[build]
build-target = "worker"

[build.args]
APP_SCOPE = "@spliit/worker"
```

with no `[http_service]` block, so the admin port stays private. Deploy it as a second Fly app.

---

## Operating it

| Task            | Command                                                            | Dashboard |
| --------------- | ------------------------------------------------------------------ | --------- |
| Tail logs       | `fly logs -a spliit-api`                                           | Live logs |
| Check health    | `fly status -a spliit-api`                                         | Overview  |
| Rotate a secret | `fly secrets set -a spliit-api KEY=value`                          | Secrets   |
| More memory     | `fly scale memory 1024 -a spliit-api`                              | Scale     |
| Roll back       | `fly releases -a spliit-api`, then `fly deploy --image <previous>` | Releases  |
| Open a shell    | `fly ssh console -a spliit-api`                                    | —         |

Migrations run automatically on every deploy via `release_command`. To run one by hand:

```sh
fly ssh console -a spliit-api -C "bun run --filter @spliit/db prisma-migrate"
```

**Back up the database.** Supabase's free tier keeps only limited automatic backups, and nothing here
is a substitute for a dump you have actually restored once.

## Troubleshooting

| Symptom                                    | Cause                                                                                                                                     |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Deploy fails in the pruner stage           | `APP_SCOPE` build arg missing — do not remove it from `fly.api.toml`                                                                      |
| API boots then exits immediately           | Env validation failed. `fly logs` names the variable; in production `BETTER_AUTH_SECRET`, `SMTP_HOST`, and `EMAIL_FROM` are all mandatory |
| Browser requests blocked by CORS           | `WEB_ORIGINS` does not exactly match the Pages origin                                                                                     |
| Signed in, but immediately signed out      | `BETTER_AUTH_URL` is not the API's real public origin                                                                                     |
| Recurring expenses never appear            | No `inline worker started` line in the logs — check `JOBS_INLINE` and that `JOBS_ENABLED` is not `false`                                  |
| Jobs enqueue but never run                 | Using the Supabase pooler on port 6543; `LISTEN/NOTIFY` needs the direct 5432 connection                                                  |
| Sign-in emails never arrive                | SMTP credentials, or missing SPF/DKIM on the sending domain                                                                               |
| Sign-in emails rejected or unsigned        | Two SPF records on one name. Only one is allowed — merge the includes, or keep sending on the subdomain                                   |
| API domain stuck awaiting certificate      | Missing `_fly-ownership` TXT record, or the zone is on Cloudflare's Flexible SSL mode rather than Full (strict)                           |
| Certificate never issues for a nested host | Free Universal SSL does not cover two-level subdomains. Use the flat `<app>-api` form, or grey-cloud that record                          |
| Release command fails                      | Bad `DATABASE_URL`, or the database is unreachable from Fly                                                                               |

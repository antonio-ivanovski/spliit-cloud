# Webhooks

Spliit can send signed expense events to HTTPS endpoints owned by permanent,
email-verified accounts. Configure endpoints in **Account settings → Webhooks**.
Each enabled endpoint receives events from every group where its owner is an
active member. New endpoints receive future events only.

Webhooks require background jobs to be enabled. Endpoints are created disabled:
save the one-time signing secret, send a test event, then enable the endpoint.

## Events

Version `v1` supports these event types:

- `expense.created`, `expense.updated`, and `expense.deleted`
- `expenses.created`, `expenses.updated`, and `expenses.deleted` for bulk work
- `webhook.test`

Every expense event contains a full expense snapshot, its group, and the actor.
Update events also include `changedFields`. Batch events contain one unbounded
`expenses` array and a `source` describing the operation. Deleted events contain
the snapshot as it existed immediately before deletion.

Every expense event is personalized per recipient: alongside the shared
snapshot, the wire body carries a `viewer` block with the endpoint owner's
take on the expense — `participantId`, `paid`, `owes`, and `net`
(`paid - owes`, all integer minor units in the ledger currency) plus
`involved` (true when the owner paid something or owes a share). Batch entries
carry one `viewer` each. `participantId` is null when the owner has no
participant row in the expense. Settlements and zero-amount expenses report
zeros. Sum `viewer.paid` / `viewer.owes` / `viewer.net` across events (deduped
by event ID — delivery is at-least-once) for personal totals. Per-expense
apportionment can differ by ±1¢ from group-level balance rounding in edge
ties; the viewer always reflects the per-expense math.

The envelope always carries `id`, `apiVersion`, `type`, `occurredAt`, and
`data`. The exact shape of `data` depends on the event type — see
[Payload schema](#payload-schema) and [Examples](#examples) below.

Fields may be added within `v1`. A breaking payload change will use a new API
version.

### Endpoint filters

Each endpoint subscribes to `created`, `updated`, and `deleted` operations
independently (at least one must stay on), and can additionally enable **Only
expenses involving me**. With that filter, singular events are skipped unless
the endpoint owner paid something or owes a share of the expense, and batch
events keep only the entries the owner is involved in (same `batchId`, fewer
entries) — each kept entry still carries its `viewer` block. Delivery history
in account settings always shows the shared stored payload, not the
per-recipient wire body, so an involved-only endpoint's history may show
entries it never received.

## Payload schema

The payload is defined by zod schemas in
[`packages/domain/src/webhooks.ts`](../packages/domain/src/webhooks.ts).
The envelope is `webhookEnvelopeSchema`; the shape of `data` depends on the
event type:

| Event type                                                 | `data` shape                                                                                                                                                            |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `expense.created`, `expense.updated`, `expense.deleted`    | `group` (`webhookGroupSchema`), `actor` (`webhookActorSchema`), `expense` (`webhookExpenseSnapshotSchema`), `viewer` (`webhookViewerSchema`), `changedFields: string[]` |
| `expenses.created`, `expenses.updated`, `expenses.deleted` | Same `group` and `actor`, plus `batchId`, `source`, and `expenses: [{ expense, viewer, changedFields }]`                                                                |
| `webhook.test`                                             | `{ message: string }`                                                                                                                                                   |

Field conventions:

- Money is integer minor units: `amount.ledger.minor`, and item `unitPrice`,
  `quantity`, and `amount`. `8450` in EUR means €84.50.
- All dates (`occurredAt`, `expenseDate`, `createdAt`) are ISO-8601 UTC
  strings.
- `apiVersion` is always the literal `"v1"`.
- `splitMode` and `paidBySplitMode` are strings such as `EVENLY`, `BY_SHARES`,
  `BY_PERCENTAGE`, or `BY_AMOUNT`.
- Expense `categoryId` is a category slug such as `dining-out` (see
  `DEFAULT_CATEGORIES` in
  [`packages/domain/src/categories.ts`](../packages/domain/src/categories.ts)).
- `changedFields` lists the snapshot fields that changed. It is empty for
  `*.created` and `*.deleted` events; update events populate it (e.g.
  `["title", "amount"]`).
- `actor.type` is `account` (with the acting user's `id` and `name`) when a
  user triggered the change, otherwise `system` (with `id` and `name` null)
  for automated work such as recurring-expense materialization.

### Batch sources

`source` is a free-form string describing which operation produced a batch.
Values currently emitted include:

- `expense-file-import` — CSV import
- `spliit-cloud-import` — import from Spliit Cloud
- `import` — generic import fallback when no provider is known
- `recurring-series-update` / `recurring-series-delete` — recurring-series edits
- `recurring-catch-up` — recurring-expense materialization
- `bulk-category-update` — bulk category reassignment
- `group-deletion` — whole-group deletion
- `member-removal-settlement`, `member-leave-settlement`,
  `participant-removal-settlement`, `invitation-revocation-settlement` —
  settlement expenses from member or invitation changes
- `force-archive-settlement` — settlement from archiving a group

This list may grow; treat `source` as informational, not an enum.

## Examples

All IDs and names below are mock data.

### `expense.created`

```json
{
  "id": "evt_9f3k7h2mQ4xZ",
  "apiVersion": "v1",
  "type": "expense.created",
  "occurredAt": "2026-09-18T14:00:00.000Z",
  "data": {
    "group": {
      "id": "grp_rome2026",
      "name": "Weekend in Rome",
      "type": "GROUP"
    },
    "actor": {
      "type": "account",
      "id": "usr_alice01",
      "name": "Alice"
    },
    "expense": {
      "id": "exp_dinner01",
      "version": 1,
      "title": "Dinner in Trastevere",
      "expenseDate": "2026-09-17T00:00:00.000Z",
      "expenseTimeZone": "Europe/Rome",
      "createdAt": "2026-09-18T14:00:00.000Z",
      "categoryId": "dining-out",
      "notes": null,
      "amount": {
        "ledger": { "minor": 8450, "currency": "EUR" },
        "original": null,
        "conversionRate": null,
        "conversionSource": null
      },
      "splitMode": "EVENLY",
      "paidBySplitMode": "EVENLY",
      "paidBy": [
        {
          "participant": {
            "id": "pt_alice",
            "name": "Alice",
            "accountId": "usr_alice01",
            "removed": false
          },
          "shares": 1
        }
      ],
      "paidFor": [
        {
          "participant": {
            "id": "pt_alice",
            "name": "Alice",
            "accountId": "usr_alice01",
            "removed": false
          },
          "shares": 1
        },
        {
          "participant": {
            "id": "pt_bob",
            "name": "Bob",
            "accountId": "usr_bob02",
            "removed": false
          },
          "shares": 1
        }
      ],
      "items": [],
      "itemizedRemainder": null,
      "documents": [],
      "createdBy": { "id": "usr_alice01", "name": "Alice" },
      "recurrence": null,
      "settlement": false
    },
    "changedFields": []
  }
}
```

### `expense.updated`

Same shape as `expense.created`, with `type: "expense.updated"` and the
changed snapshot fields listed in `changedFields`:

```json
{
  "id": "evt_7h2mQ4xZ9f3k",
  "apiVersion": "v1",
  "type": "expense.updated",
  "occurredAt": "2026-09-18T15:30:00.000Z",
  "data": {
    "group": {
      "id": "grp_rome2026",
      "name": "Weekend in Rome",
      "type": "GROUP"
    },
    "actor": {
      "type": "account",
      "id": "usr_alice01",
      "name": "Alice"
    },
    "expense": {},
    "changedFields": ["title", "amount"]
  }
}
```

(The `expense` object is elided here; it carries the full snapshot with the
new values applied.)

### `expense.deleted`

Identical shape to `expense.created`, with `type: "expense.deleted"`. The
snapshot reflects the expense as it existed immediately before deletion.

### `expenses.created`

Batch events wrap one entry per expense. Each entry has the same `expense`
snapshot shape as the singular events plus its own `changedFields`:

```json
{
  "id": "evt_4xZ9f3k7h2mQ",
  "apiVersion": "v1",
  "type": "expenses.created",
  "occurredAt": "2026-09-18T16:00:00.000Z",
  "data": {
    "group": {
      "id": "grp_rome2026",
      "name": "Weekend in Rome",
      "type": "GROUP"
    },
    "actor": {
      "type": "account",
      "id": "usr_bob02",
      "name": "Bob"
    },
    "batchId": "batch_csv_01H9",
    "source": "expense-file-import",
    "expenses": [
      {
        "expense": {
          "id": "exp_groceries01",
          "version": 1,
          "title": "Groceries",
          "expenseDate": "2026-09-16T00:00:00.000Z",
          "expenseTimeZone": "Europe/Rome",
          "createdAt": "2026-09-18T16:00:00.000Z",
          "categoryId": "groceries",
          "notes": null,
          "amount": {
            "ledger": { "minor": 2340, "currency": "EUR" },
            "original": null,
            "conversionRate": null,
            "conversionSource": null
          },
          "splitMode": "EVENLY",
          "paidBySplitMode": "EVENLY",
          "paidBy": [
            {
              "participant": {
                "id": "pt_bob",
                "name": "Bob",
                "accountId": "usr_bob02",
                "removed": false
              },
              "shares": 1
            }
          ],
          "paidFor": [
            {
              "participant": {
                "id": "pt_alice",
                "name": "Alice",
                "accountId": "usr_alice01",
                "removed": false
              },
              "shares": 1
            },
            {
              "participant": {
                "id": "pt_bob",
                "name": "Bob",
                "accountId": "usr_bob02",
                "removed": false
              },
              "shares": 1
            }
          ],
          "items": [],
          "itemizedRemainder": null,
          "documents": [],
          "createdBy": { "id": "usr_bob02", "name": "Bob" },
          "recurrence": null,
          "settlement": false
        },
        "changedFields": []
      },
      {
        "expense": {
          "id": "exp_metro01",
          "version": 1,
          "title": "Metro tickets",
          "expenseDate": "2026-09-16T00:00:00.000Z",
          "expenseTimeZone": "Europe/Rome",
          "createdAt": "2026-09-18T16:00:00.000Z",
          "categoryId": "bus-train",
          "notes": null,
          "amount": {
            "ledger": { "minor": 900, "currency": "EUR" },
            "original": null,
            "conversionRate": null,
            "conversionSource": null
          },
          "splitMode": "EVENLY",
          "paidBySplitMode": "EVENLY",
          "paidBy": [
            {
              "participant": {
                "id": "pt_bob",
                "name": "Bob",
                "accountId": "usr_bob02",
                "removed": false
              },
              "shares": 1
            }
          ],
          "paidFor": [
            {
              "participant": {
                "id": "pt_alice",
                "name": "Alice",
                "accountId": "usr_alice01",
                "removed": false
              },
              "shares": 1
            },
            {
              "participant": {
                "id": "pt_bob",
                "name": "Bob",
                "accountId": "usr_bob02",
                "removed": false
              },
              "shares": 1
            }
          ],
          "items": [],
          "itemizedRemainder": null,
          "documents": [],
          "createdBy": { "id": "usr_bob02", "name": "Bob" },
          "recurrence": null,
          "settlement": false
        },
        "changedFields": []
      }
    ]
  }
}
```

### `webhook.test`

```json
{
  "id": "evt_test01H9wxyz",
  "apiVersion": "v1",
  "type": "webhook.test",
  "occurredAt": "2026-09-18T14:05:00.000Z",
  "data": { "message": "Spliit webhook test" }
}
```

## Verify signatures

Spliit uses the Standard Webhooks header format:

- `webhook-id`: the envelope event ID
- `webhook-timestamp`: Unix time in seconds
- `webhook-signature`: `v1,<base64 signature>`

To verify a request, remove the `whsec_` prefix from the displayed secret and
Base64-decode the remainder. Compute HMAC-SHA256 over the exact UTF-8 string
`<webhook-id>.<webhook-timestamp>.<raw request body>`, then compare its Base64
value with the signature using a constant-time comparison. Reject timestamps
outside your chosen replay window.

Do not parse and reserialize the body before verification.

Example (Node.js, no dependencies):

```ts
import { createHmac, timingSafeEqual } from 'node:crypto'

function verifyWebhookSignature(opts: {
  /** Signing secret without the `whsec_` prefix (still Base64-encoded). */
  secret: string
  /** `webhook-id` header. */
  webhookId: string
  /** `webhook-timestamp` header. */
  timestamp: string
  /** Exact raw request body as UTF-8 text — do not parse it first. */
  rawBody: string
  /** `webhook-signature` header, e.g. `v1,<base64>`. */
  signatureHeader: string
}): boolean {
  const parts = opts.signatureHeader.split(',')
  if (parts.length !== 2 || parts[0] !== 'v1' || !parts[1]) return false
  const key = Buffer.from(opts.secret, 'base64')
  const expected = createHmac('sha256', key)
    .update(`${opts.webhookId}.${opts.timestamp}.${opts.rawBody}`, 'utf8')
    .digest()
  const actual = Buffer.from(parts[1], 'base64')
  if (expected.length !== actual.length) return false
  // Reject timestamps outside your replay window (e.g. 5 minutes).
  const ageSeconds = Math.abs(Date.now() / 1000 - Number(opts.timestamp))
  if (!Number.isFinite(ageSeconds) || ageSeconds > 5 * 60) return false
  return timingSafeEqual(expected, actual)
}
```

## Delivery behavior

Delivery is at least once and ordering is not guaranteed. Any `2xx` response is
successful. Network failures, timeouts, `408`, `409`, `425`, `429`, and `5xx`
responses are retried with exponential backoff (8 retries). Redirects
are not followed; other non-`2xx` responses fail permanently.

Successful deliveries are retained for 7 days. Failed and canceled deliveries
are retained for 30 days. Account settings exposes the stored payload, attempt
metadata, and a manual resend action; response bodies are never stored. Resend
requires the endpoint to be enabled — including for deliveries canceled while
it was disabled — and is unavailable while a delivery is queued or in flight.

Disabling an endpoint or changing its URL cancels pending work; unsubscribing
an event type cancels that type's pending deliveries while leaving
still-subscribed types queued. Deleting an
endpoint removes its history immediately. Changing the URL also disables the
endpoint. An already in-flight request can still finish. Re-enabling an
endpoint does not replay events missed while it was disabled.

## Network policy

By default, endpoint URLs must use HTTPS and resolve only to public IP addresses.
Self-hosters can set `WEBHOOK_ALLOW_PRIVATE_ENDPOINTS=true` to permit HTTP and
private-network destinations. This weakens SSRF protections and should only be
used in trusted networks.

## Relay mode

Direct delivery reveals the server IP to every webhook destination. Relay mode
sends each delivery — including `webhook.test` events — through a Cloudflare
Worker first, so destinations only ever see the Cloudflare source IP. The relay
only forwards: retries, history, and webhook signatures stay in Spliit, and the
original body and `webhook-*` headers reach the destination unchanged (verify
signatures exactly as in direct mode).

The relay is deployment configuration only; there are no per-endpoint settings
and no fallback to direct delivery. If the relay is unreachable, deliveries
retry as transient failures — they are never sent directly, which could both
leak the server IP and deliver events twice.

### Setup

The relay is a small Cloudflare Worker in `apps/webhook-relay`, and any
self-hoster can deploy and operate their own instance of it — there is no
Spliit-hosted relay involved. The setup below is how this is solved for the
public spliit.cloud instance; self-hosters follow the same steps with their
own Cloudflare account, worker name, and URLs:

1. Deploy the worker in `apps/webhook-relay`:
   `bunx wrangler login && bunx wrangler deploy`. (For the spliit.cloud
   instance the release workflow deploys the worker automatically on every
   version tag — it only needs a `CLOUDFLARE_API_TOKEN` repo secret.)
2. Set the shared HMAC secret (min 32 chars, unrelated to
   `BETTER_AUTH_SECRET`) via secret storage, never in `wrangler.jsonc`:
   `bunx wrangler secret put RELAY_SECRET`.
3. Set `WEBHOOK_RELAY_URL` (the full `.../forward` URL) and
   `WEBHOOK_RELAY_SECRET` (same value) on the Spliit **api and worker**
   services (the background job runner — the Cloudflare Worker itself only
   needs `RELAY_SECRET` from step 2), then restart both.
4. Send a test event to a request-inspection endpoint and confirm the
   Cloudflare source IP and a valid `webhook-signature` before relying on it.

Rules enforced at boot: both variables together or neither; the relay URL must
be HTTPS (HTTP is only accepted for local `wrangler dev` testing together with
`WEBHOOK_ALLOW_PRIVATE_ENDPOINTS=true`); and an HTTPS relay cannot be combined
with `WEBHOOK_ALLOW_PRIVATE_ENDPOINTS=true`, because the relay cannot reach
private networks. Relayed destinations must be public HTTPS (explicit ports
allowed); IP literals and credential-bearing URLs are rejected.

The envelope is documented in `apps/webhook-relay/src/index.ts`: Spliit signs
`version`, canonical destination, 60-second expiry, attempt ID, and the
sha256 of the raw body. The worker accepts envelopes up to 30 seconds past
expiry for clock skew. The worker returns the destination status verbatim and
answers any relay-side failure with `502`, which Spliit retries.

Limitations: Spliit still resolves destination hostnames during validation, so
the DNS resolver sees them — the relay hides the server IP from the
_destination_, nothing more. Relay logs contain only the attempt ID and
outcome, and only for failures and upstream error statuses. Roll back by
unsetting both variables and restarting.

## Secrets

Signing secrets are derived from `BETTER_AUTH_SECRET`. Rotating an endpoint
secret takes effect immediately with no overlap. Changing `BETTER_AUTH_SECRET`
changes every derived webhook secret, so rotate or redistribute endpoint
secrets as part of that operational change.

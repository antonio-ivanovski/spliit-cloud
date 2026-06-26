## 1. Backend Schema And Helpers

- [ ] 1.1 [Backend] Add `kind` (`ACCOUNT_MEMBER` / `UNLINKED_PARTICIPANT`) and `displayName` to `LedgerParticipant`.
- [ ] 1.2 [Backend] Update `getGroup` to include unlinked `LedgerParticipant` rows in the participants list (with `unlinked: true`).
- [ ] 1.3 [Backend] Update `createExpense` / `updateExpense` participant-validation query to allow unlinked `LedgerParticipant` rows in `paidBy` / `paidFor`.
- [ ] 1.4 [Backend] Extend `resolveParticipantDisplayName` to fall back to `displayName` for unlinked rows.
- [ ] 1.5 [Backend] Add `importGroup` helper in `apps/api/src/lib/api.ts` that runs the transactional write for a single batch (group + participants + expenses). Destination group id is always a fresh id.
- [ ] 1.6 [Backend] Add one-way admin mapping helper that migrates an unlinked `LedgerParticipant` to an account and creates/activates the corresponding `GroupMember`.

## 2. Backend Import Procedure

- [ ] 2.1 [Backend] Add protected `groups.import` procedure: input is `{ targetGroupId?, groupFormValues?, sourceMeta?: { provider, sourceGroupId, sourceUrl }, participants: mapping[], expenses: ExpenseFormValues[] }`; output is `{ groupId, ledgerId }`.
- [ ] 2.2 [Backend] Re-run Zod validation on the batch payload (defense-in-depth) and reject with a clear error when the input shape is wrong.
- [ ] 2.3 [Backend] Authorize the call: ADMIN of the target group, or any signed-in user for a new group.
- [ ] 2.4 [Backend] Record an `UPDATE_GROUP` activity entry with `data = "Imported from <provider> group <sourceId>"` so the source identity is auditable without leaking into the primary key.
- [ ] 2.5 [Backend] Add `importLinks.listUnlinked` and `importLinks.link` procedures (one-way admin link).

## 3. Backend URL Proxy, In-Memory Cache, And Group Lookup

- [ ] 3.1 [Backend] Add a simple in-memory cache keyed by source group id (e.g. `spliit.app` group id). Bounded size, short TTL, per-process. Cache stores the parsed source payload and acts as the "is this group known to us on `spliit.app`?" detector.
- [ ] 3.2 [Backend] Add a server-side URL proxy endpoint (e.g. `import.previewFromUrl`): input `{ sourceUrl }`, output `{ kind: 'OK', source: NormalizedSource }` or `{ kind: 'NOT_FOUND' | 'ERROR', ... }`. The server makes the cross-origin call so the web app never touches `spliit.app` directly. Cache lookups short-circuit the fetch on a hit; misses populate the cache.
- [ ] 3.3 [Backend] Implement the `spliit.app` URL parser on the server: given a `https://spliit.app/groups/<id>` URL, fetch the export JSON, validate it against the Spliit export shape, and return the parsed source.
- [ ] 3.4 [Backend] Apply rate limits and an access policy to the proxy so a malicious URL can't hammer `spliit.app` through our server.
- [ ] 3.5 [Backend] Add a `groups.lookup` (or extend `groups.get`) "not found" hand-off: when a group id does not exist locally, the server checks the in-memory cache. A cache hit returns `{ status: 'IMPORTABLE', sourceProvider, sourceUrl, sourceGroupId }`; a cache miss attempts a `spliit.app` fetch and caches the result on success.

## 4. Frontend Web Wizard

- [ ] 4.1 [Frontend] Add `/groups/import` route with a six-step wizard state machine: source, destination, preview, mapping, confirm, done. No server-stored state. **Import is all-or-nothing** — the wizard never offers per-expense skip; only per-participant skip.
- [ ] 4.2 [Frontend] Source step: file upload for JSON and CSV, plus an optional URL field. The URL field calls the server-side `import.previewFromUrl` proxy (never fetches `spliit.app` directly). When the user arrives with `?source=<encoded sourceUrl>`, skip directly to the destination step.
- [ ] 4.3 [Frontend] Implement the Spliit JSON parser: maps a Spliit export JSON into the in-memory shape (group metadata + source participants + source expenses) used by the wizard.
- [ ] 4.4 [Frontend] Implement the Spliit CSV parser: maps a Spliit export CSV into the same in-memory shape.
- [ ] 4.5 [Frontend] Destination step: pick "new group" (renders the existing `groupFormValues` form) or "import into existing group" (renders a group picker restricted to groups the user is an active member of). The destination step is the **landing point** for users arriving from the not-found hand-off.
- [ ] 4.6 [Frontend] Preview step: render parsed group, participants, and expenses; surface per-row validation issues before the user moves on.
- [ ] 4.7 [Frontend] Mapping step: per source participant, choose link to existing account, unlink by name, or skip. Auto-suggest by name. Bulk actions for "link all to my account" / "leave all unlinked". SKIP rows are dropped from `paidBy` / `paidFor` before the batch is built. Per-expense skip is **not** available.
- [ ] 4.8 [Frontend] Resolve source→destination participant ids and assemble the batch payload (`groupFormValues` / `targetGroupId` + `participants` + `expenses`) using the existing `expenseFormSchema` shape. Include `sourceMeta` so the server can record the import activity.
- [ ] 4.9 [Frontend] Confirm step: show a summary (group name, participant mapping count, expense count) and submit. On success, navigate to the new (or existing) group.
- [ ] 4.10 [Frontend] Surface the wizard entry point from the signed-in homepage (next to the create-group action).

## 5. "Not Found" Hand-Off Routing

- [ ] 5.1 [Frontend] When `groups.get` returns the `IMPORTABLE` status, route the user to `/groups/import?source=<encoded sourceUrl>` with the wizard pre-filled on the **destination step** (the source step is skipped).
- [ ] 5.2 [Frontend] The "group not found" page handles three outcomes from the lookup: (a) the group exists locally → show the group; (b) the group is importable from a configured provider → show the import CTA; (c) the group does not exist anywhere → show the existing not-found page.

## 6. UI Design Handoff

- [ ] 6.1 [UI] Design the five wizard screens (source, preview, mapping, confirm, done) and their loading / empty / error states.
- [ ] 6.2 [UI] Design the participant mapping row: source name, destination account picker, unlinked toggle, skip control, and validation/error affordance.
- [ ] 6.3 [UI] Design the unlinked label and badge that surfaces in expense cards, balances, expense forms, and the admin linking flow so unlinked people are not confused with app users.
- [ ] 6.4 [UI] Design the post-import "link unlinked" admin flow: list unlinked entries, pick the destination account, confirm the one-way migration, and surface the resulting membership activation.
- [ ] 6.5 [UI] Design the "not found" → import CTA: how the "this group is on `spliit.app`, would you like to import it?" prompt reads and behaves.
- [ ] 6.6 [UI] Design the URL-proxy error state (when `spliit.app` is unreachable or returns non-export data) so the user can fall back to JSON/CSV without losing the wizard state.

## 7. Verification

- [ ] 7.1 [Testing] Add parser unit tests for the Spliit JSON parser and the Spliit CSV parser using representative fixtures.
- [ ] 7.2 [Testing] Add a unit test for the server-side Spliit URL proxy against a recorded fixture (mock `fetch`), covering success, not-found, and rate-limit cases.
- [ ] 7.3 [Testing] Add a unit test for `importGroup` covering: new group case, existing group case, mixed mapping modes, and SKIP / unlinked / linked-account combinations. Assert that the destination group id is a fresh id (not the source id) and that the import activity entry references the source id.
- [ ] 7.4 [Testing] Add a unit test for the one-way admin link helper covering: existing member, removed member reactivation, and account-not-a-member creation.
- [ ] 7.5 [Testing] Add a unit test for the `groups.lookup` "not found" hand-off covering: local group exists, local missing + source exists, local missing + source missing.
- [ ] 7.6 [Testing] Add Playwright coverage for the wizard happy path (JSON → new group), the existing-group merge case, the post-import link flow, the URL-proxy path, the "not found" → import hand-off, and the URL-proxy error fallback.
- [ ] 7.7 [Testing] Run `bun check-types`, `bun run test`, and the import Playwright specs.

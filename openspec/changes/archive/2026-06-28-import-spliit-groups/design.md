## Context

The new account-backed product requires authentication to use the app, but imported data may contain people who do not have accounts, have left the group, or should never be invited. The first source is existing Spliit groups, but the import UX should be a small wizard that runs entirely in the web app: the user picks a source, previews the parsed data, maps participants, and submits. The server is the executor, not the wizard host.

This design depends on `add-accounts-cloud-group-sync` for accounts, group memberships, authorization, and cloud group source-of-truth semantics. It must support both direct import by `spliit.app` group URL (best-effort) and import from exported JSON/CSV (the reliable path). Splitwise import is out of scope, but the wizard and server procedure are generic enough to accept new source types later by adding a parser in the web.

A second entry point is the "not found" hand-off: when a user navigates to a group URL that does not exist on the new domain, the server tries to look it up on `spliit.app` and, if it finds it, routes the user into the import wizard with the source pre-filled. This is the recommended path for users who switch from `spliit.app` to the new domain: they paste their old group URL and the import is offered automatically. Imported groups get a **fresh cloud group id**; the source id is recorded in the activity feed for traceability but is not reused as the destination id (destination ids stay short and unpredictable).

## Goals / Non-Goals

**Goals:**

- Let a user import a Spliit group — into a new cloud group or an existing one — in one short session with no long-lived server state.
- Accept Spliit URL, exported JSON, and exported CSV as source inputs. URL is best-effort; JSON/CSV is the reliable path.
- Show a preview of the parsed group, participants, and expenses before the user commits.
- Let the user map each source participant to an existing account, an unlinked name-only entry, or skip.
- Persist the imported group as a normal cloud group with an account-backed membership model and a ledger.
- Keep imported unlinked participants visible in expenses and balances; let an owner/admin link them to an account after the import.

**Non-Goals:**

- Circumventing `spliit.app` access controls or scraping private data the importer cannot access.
- Guaranteeing document import if the source document URLs are inaccessible or terms disallow copying. The server keeps the source URLs as references; the user re-uploads documents if they want them in our storage.
- Granting app access to unlinked participant entries.
- Automatically forcing every imported participant to create an account.
- Solving every old schema variant without validation failure paths.
- Cross-device wizard resume. The wizard is a single browser session.
- Server-side audit trail of source→destination records. The imported group is the audit.
- Implementing Splitwise import in this change.

## Decisions

### 1. The web app drives the wizard; the server is the executor

The import is a single browser session:

1. **Source** — pick a source (file upload for JSON/CSV, or paste a `spliit.app` group URL), OR arrive with a source already pre-filled from the "not found" hand-off (see Decision 1b). URL fetches go through the server-side proxy (Decision 3b / 3c).
2. **Destination** — choose between creating a new cloud group or importing into an existing group the user is a member of. (When the user arrives from the not-found hand-off, the source is already known; this step is the wizard's landing point.)
3. **Preview** — parsed group metadata, source participants, and source expenses, with per-row validation surfaced.
4. **Mapping** — per source participant, link to an existing account, leave unlinked by name, or skip. SKIP rows are dropped from `paidBy` / `paidFor` before the batch is built.
5. **Confirm** — review the summary and submit. The server creates everything in a single transaction.
6. **Done** — link to the new (or existing) group.

There is no `ImportSession` table, no `ImportParticipant` table, no `ImportIssue` table, no `ImportSourceRecord` table. The wizard lives in component state.

Rationale: import is a short interactive event. Holding state on the server adds lifecycle complexity, race conditions, and a table to migrate later. The web already needs a preview/mapping UI anyway, so all the wizard state is in the browser.

Alternatives considered:

- Server-stored wizard sessions (the original design): rejected as over-engineered. Adds a table, a service, and a router for state that lives in the browser during one session.
- Fully client-side import with no server involvement: rejected because the destination group must be created transactionally on the server. The batch submit keeps that guarantee.
- Browser-side URL fetch for `spliit.app`: rejected because the public `spliit.app` API either doesn't support CORS or rotates access. The server-side proxy keeps the cross-origin call, the access policy, and the rate-limit handling on the server.

### 1b. "Group not found" hand-off into the import wizard

When a user navigates to `/groups/<id>` on the new domain and the group does not exist locally, the server treats that as a potential import request rather than a hard 404:

- The existing `groups.get` (or a thin companion `groups.lookup`) procedure tries to fetch the source group from `spliit.app` (or from the configured import providers) using the same server-side proxy as Decision 1.
- If the source group is found, the server returns a structured "importable" response: `{ status: 'IMPORTABLE', sourceUrl, sourceGroupId, sourceProvider: 'SPLIIT' }`. The web app reads this and routes to `/groups/import?source=<encoded sourceUrl>` with the wizard pre-filled.
- If the source group is not found on `spliit.app` either, the server returns a normal "not found" response and the web app shows the existing not-found page.

The hand-off is a discovery convenience, not a bypass: the user still walks the import wizard, still maps participants, and still confirms. The only thing it skips is the manual "pick a source" step.

Important: when the import commits, the destination group id is a **fresh** id (the server generates it). The source group id is recorded in the destination group's first activity entry as a `data` string ("Imported from `spliit.app` group `<sourceId>`") so the audit trail is preserved without leaking the source id into the destination primary key.

Rationale: destination group ids are short, opaque, and should not collide with source ids. The "switch your domain" UX is the cleanest onboarding for users moving from `spliit.app` to the new domain, and the source group id entropy is high enough that a missing local group is almost always a deliberate cross-domain paste.

Alternatives considered:

- Reuse the source group id as the destination id: rejected. The source id is from a different id space; mixing them risks collisions and weakens the "destination id is a fresh opaque token" invariant.
- Auto-import on the first visit: rejected. Mapping and confirmation are mandatory, so this is only a routing convenience.

### 1c. Import is all-or-nothing — no partial imports

The wizard does not let the user pick a subset of expenses to bring in. Either every expense in the parsed source is imported, or the import is blocked by validation. Per-expense skip is only for source participants (which the user marks `SKIP` and which the web app drops from `paidBy` / `paidFor` before submitting), never for expenses.

Rationale: financial history is all-or-nothing by nature. Letting the user pick a subset of expenses during import is a high-risk UX (the user might forget an expense that mattered), and it complicates the server's transactional commit (which expenses are in the batch vs. which are out?). If the user wants a subset later, they can delete individual expenses from the imported group.

Alternatives considered:

- Optional per-expense checkbox in the wizard: rejected. See above. Defer to "delete individual expenses after import" if the user wants to drop something.
- Per-category or per-date filter: rejected. Same reason, plus these filters are easy to add later as plain expense queries once the data is in the cloud.

### 2. Reuse the existing form schemas for the batch payload

The web builds a payload that uses the same Zod schemas as the regular create-group / create-expense flows:

- `groupFormValues` (name, information, currency, currencyCode) when creating a new group.
- `participants: [{ sourceName, mode: 'LINK_ACCOUNT' | 'UNLINKED_PARTICIPANT' | 'SKIP', linkedAccountId? }]` — one entry per source participant.
- `expenses: [ExpenseFormValues]` — each expense already references participants by their destination `LedgerParticipant` id, so the web must resolve source ids → destination ids before submitting.

The web resolves the source→destination mapping before submit: for each `paidBy` / `paidFor` reference, it picks the destination `LedgerParticipant` id that the server will create (account-backed or unlinked). SKIP participants are dropped from expenses before submit.

Rationale: reuses the existing form schemas, validation, and `expenseFormSchema` shape. The server doesn't need a parallel "import expense" schema.

Alternatives considered:

- A new import-specific expense schema: rejected. The destination data shape is the same; only the import-specific identifier is the source participant id, which the web resolves client-side.

### 3. One server procedure, one transactional write

The server exposes a single `groups.import` procedure:

```ts
input: {
  // Either provide a target group id to merge into an existing group,
  // or provide form values to create a new one.
  targetGroupId?: string
  groupFormValues?: GroupFormValues
  // Per source participant, the mapping decision.
  participants: Array<{
    sourceName: string
    mode: 'LINK_ACCOUNT' | 'UNLINKED_PARTICIPANT' | 'SKIP'
    linkedAccountId?: string
  }>
  // Imported expenses, already resolved to destination participant ids.
  expenses: Array<ExpenseFormValues>
}
```

The procedure:

1. Verifies the caller is authorized (admin of the target group, or any signed-in user for a new group).
2. Opens a Prisma transaction.
3. Creates or reuses the group and ledger (the destination group id is always a fresh id, regardless of any source id; see Decision 1b).
4. For each mapping, creates a `LedgerParticipant` (account-backed for `LINK_ACCOUNT`, unlinked for `UNLINKED_PARTICIPANT`) and, for `LINK_ACCOUNT`, creates/activates the `GroupMember`.
5. For each expense, calls the existing expense-creation path (so documents, split math, and activity logging all behave the same as a normal expense).
6. Records an `UPDATE_GROUP` activity entry with `data = "Imported from <provider> group <sourceId>"` so the source identity is auditable without leaking into the primary key.
7. Returns `{ groupId, ledgerId }`.

Rationale: a single procedure is the simplest possible API. The transactional guarantee is provided by Prisma's `$transaction`; the per-expense work reuses the existing `createExpense` helper for consistency.

Alternatives considered:

- A `createImportSession` / `commitImport` pair with server-stored state: rejected (see Decision 1).
- A per-expense `createExpense` call from the web: rejected. The web would need to handle partial failures across N HTTP calls; the server should commit atomically.

### 3b. Server-side URL proxy for `spliit.app` group discovery

The web app never fetches `spliit.app` directly. Instead, the server exposes a small discovery endpoint (for example `import.previewFromUrl` or `groups.lookup`):

- Input: `{ sourceUrl: string }` (a `spliit.app` group URL, or just the id).
- Output: either `{ kind: 'OK', source: NormalizedSource }` with the parsed group ready to drop into the wizard, or `{ kind: 'NOT_FOUND' }` / `{ kind: 'ERROR', message }` for the failure cases.
- The server makes the cross-origin call, applies the access policy / rate limits, and returns the parsed payload.
- The wizard's "source" step calls this endpoint when the user provides a URL and shows the preview without ever touching `spliit.app` itself.

Rationale: the public `spliit.app` API is rate-limited and access is policy-sensitive. The server is the right place for the cross-origin call so the URL fetch, retry policy, and access policy are server-controlled. It also gives the server everything it needs to power the "not found" hand-off (Decision 1b).

### 3c. In-memory cache keyed by source group id

The URL proxy keeps a small in-memory cache keyed by the source group id (the `spliit.app` group id, or whatever id the configured provider uses). The cache is the single source of truth for "is this source group known to us?":

- A cache hit returns the previously parsed source payload without re-fetching from `spliit.app`.
- A cache miss triggers a `spliit.app` fetch; on success the parsed payload is stored in the cache; on failure the call returns `NOT_FOUND` or `ERROR`.
- The cache is per-process (in-memory, no Redis, no DB), bounded in size, and has a short TTL (e.g. a few minutes) so stale source data is bounded.
- The "not found" hand-off (Decision 1b) reuses the same cache: when a local group lookup misses, the server checks the cache, and a cache hit is the signal that the group exists on `spliit.app` (because we have a recent successful fetch on record).

Rationale: a single in-memory cache doubles as a fetch accelerator (no need to re-fetch during a wizard session) and as the "have we seen this group on `spliit.app`" detector for the not-found-import flow. It avoids the complexity of a distributed cache or a separate source-discovery table while still being fast and bounded.

Alternatives considered:

- No cache (every URL proxy call hits `spliit.app`): rejected. The wizard may re-fetch on every step, and the not-found flow would always re-fetch too. Wasteful and slow.
- A `SourceGroupCache` table in the database: rejected. The data is short-lived and doesn't need transactional durability. The cache is invalidated on TTL; a database table would be a write per lookup.
- A third-party cache (Redis): rejected for v1. Per-process in-memory is good enough for a single-node deployment; switching to Redis is a bounded change when we need it.

### 4. Unlinked `LedgerParticipant` entries for people without accounts

The destination schema gains:

- `LedgerParticipant.kind: LedgerParticipantKind` — `ACCOUNT_MEMBER` (default) or `UNLINKED_PARTICIPANT`.
- `LedgerParticipant.displayName: String?` — populated only for unlinked entries; null for account-backed ones.

The existing `getGroup` participants list and the existing `createExpense` / `updateExpense` participant-validation list both gain `OR: { kind: 'UNLINKED_PARTICIPANT' }` so unlinked entries are selectable in expense forms and balance rows. The existing `resolveParticipantDisplayName` falls back to `displayName` for unlinked entries.

Enforcement: the import procedure is the only writer that creates `UNLINKED_PARTICIPANT` rows. No other code path sets `kind` explicitly (so it defaults to `ACCOUNT_MEMBER`). UI flows (invite, member management) do not surface an "add unlinked participant" action.

Rationale: imported groups must balance correctly even when some people are not cloud users. Adding a kind to the existing `LedgerParticipant` is the minimum schema change that supports this.

Alternatives considered:

- A separate `UnlinkedParticipant` table: rejected. The existing `LedgerParticipant` already supports `groupMemberId = null` (for the pending-invite use case); adding a `kind` enum reuses the same table and the same query paths.
- A "shadow" Account for each unlinked person: rejected. It conflates real users with imported-name placeholders and pollutes the account listing.

### 5. One-way admin mapping after import

The existing `importLinks` flow (already in the original proposal) survives: an owner/admin can call a `link` procedure to migrate an unlinked `LedgerParticipant` to an account. The destination `GroupMember` is created or reactivated, the `LedgerParticipant.groupMemberId` is set, and `kind` flips to `ACCOUNT_MEMBER`. The historical and future balances of the participant immediately contribute to the linked account's group and overview totals.

Rationale: people who were unlinked at import time (departed members, friends without accounts) may eventually sign up. A one-way link keeps the model simple — there is no un-link state.

### 6. Validation happens in the web, with a server-side defense-in-depth check

The web runs validation on the parsed payload before the submit button enables. Validation includes:

- Every source participant has a mapping decision.
- No two source participants have the same `sourceName` (case-insensitive).
- Every `paidBy` / `paidFor` reference resolves to a destination participant id.
- Every expense's split math is internally consistent.
- The destination group form values pass the existing `groupFormSchema` validation.

The server re-runs the same Zod checks on the batch payload via tRPC's input validation. Server-side validation never has to invent issues that the web didn't already surface; it's a guard against tampered or buggy clients.

Rationale: validation in the web gives the user immediate feedback during the wizard; server-side Zod validation guarantees the same shape rules apply regardless of client. There is no separate "validator service" — the existing schemas are the contract.

Alternatives considered:

- A standalone `ImportValidator` service: rejected. The web needs the same checks for the preview; reusing the existing schemas avoids two implementations of the same rules.

### 7. No server-side audit trail, no duplicate detection

The original design proposed `ImportSourceRecord` and a payload-hash duplicate check. Both are dropped:

- Audit trail: the imported group itself records what was created, when, by whom, and with what data. Activity entries, expense history, and the group ledger are the audit. A separate import audit table would only duplicate that information.
- Duplicate detection: out of scope for v1. If a user accidentally re-imports the same JSON, they end up with two groups — the same behavior as accidentally creating any duplicate group today. A simple "you have a group with this name already" warning is enough for the foreseeable UX. A full duplicate-detection mechanism (source id, payload hash, source→destination record mapping) can be added later if needed without changing the public API.

Rationale: the cost (a multi-table schema, hashing, fuzzy matching) outweighs the benefit (catching rare user mistakes) for v1.

## Risks / Trade-offs

- [Risk] Direct `spliit.app` URL import may be unstable or disallowed. -> Mitigate with the JSON/CSV fallback as the reliable path. URL import is best-effort and surfaces a clear error when it fails.
- [Risk] Source-specific parsing complexity leaks into the web. -> Mitigate by keeping each parser small and returning the same in-memory shape (the destination `expenseFormValues` + per-participant mapping). New sources are a new parser file in the web, not a new server concept.
- [Risk] Unlinked participant entries can be mistaken for app users. -> Mitigate by labeling them as unlinked in the UI, giving them no access, and surfacing a dedicated "unlinked" entry point for the post-import admin link flow.
- [Risk] Mapping UX can become complex for large groups. -> Mitigate with bulk actions, search, and auto-suggest by name/email in the wizard.
- [Risk] The web submits a large batch in a single call. -> Mitigate by chunking expenses on the client when the batch exceeds a sensible size (e.g. > 500 expenses), or by failing with a clear error if a single transaction is too large. Spliit exports are typically < 200 expenses, so this is not a current concern.
- [Risk] A bug in the parser corrupts financial history. -> Mitigate by reusing the existing `expenseFormSchema` Zod validation on both client and server, and by previewing the parsed result before submit.

## Migration Plan

1. Extend `LedgerParticipant` with `kind` and `displayName`. Backfill is unnecessary — every existing row defaults to `ACCOUNT_MEMBER`.
2. Update `getGroup`, `createExpense`, and `updateExpense` to include unlinked `LedgerParticipant` rows in their participants list.
3. Extend `resolveParticipantDisplayName` to fall back to `displayName` for unlinked rows.
4. Add the `importGroup` helper and the `groups.import` procedure.
5. Add the `importLinks.listUnlinked` and `importLinks.link` procedures (one-way admin link).
6. Add the web wizard at `/groups/import`: source selection → preview → mapping → confirm → done.
7. Surface the wizard entry point from the signed-in homepage.
8. Add unit tests for the parsers, the `importGroup` helper, and the existing schemas; add a Playwright happy-path test for the wizard.

Rollback strategy: keep the import entry point hidden behind a feature flag until stable. The schema additions (`kind`, `displayName`) are additive and can stay even if the wizard is disabled.

## Open Questions

- _Resolved:_ All-or-nothing import. The wizard never lets the user pick a subset of expenses; every expense in the parsed source is either imported or the import is blocked by validation. Decision 1c.
- _Resolved:_ The "not found" hand-off signals "intent to import" to the web app, which routes the user into the import wizard at the **destination step** (new group vs. existing group) with the source already pre-filled. Decision 1b.
- _Resolved:_ The URL proxy uses a simple in-memory cache keyed by source group id. The cache is also the lookup that determines whether a `spliit.app` group exists during the not-found-import flow. Decision 3c.

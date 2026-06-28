## Why

Users with existing expense data need a path into the account-backed product without manually recreating participants and expenses. The first supported source is existing Spliit groups, but the import UX should be flexible enough to accept exported JSON, exported CSV, or a `spliit.app` group URL when one is reachable.

Importing should be a single, short-lived event: the user picks a source, reviews and maps the participants, and commits. There is no long-running wizard server-side and no need for a rich import audit trail — the imported group itself records what was created.

## What Changes

- Add an import wizard in the web app with six steps: **source → destination → preview → mapping → confirm → done**. The destination step lets the user pick "new group" or "import into existing group". The source step accepts a file (JSON/CSV) or a `spliit.app` group URL.
- The web app parses the chosen source, holds the in-memory parsed payload, and runs the mapping UX. No wizard state is persisted on the server.
- The web app submits a single batch payload to the server when the user confirms. The payload uses the existing `groupFormValues` + `expenseFormValues` shapes, extended with the per-participant mapping decisions and a `sourceMeta` descriptor (provider, source group id, source url).
- Add one protected server procedure (`groups.import`) that creates a new group and ledger (or reuses an existing one), materializes account-backed and unlinked participants, and writes all imported expenses in a single transaction. **Import is all-or-nothing**: every parsed expense is imported or the call fails.
- Add a server-side proxy for `spliit.app` group URLs. The web app asks the server to fetch the source group; the server makes the cross-origin call, applies an access policy / rate limit, and returns the parsed payload. This avoids CORS issues and keeps `spliit.app` access policy decisions on the server.
- The proxy uses a **simple in-memory cache keyed by source group id** to avoid re-fetching on every wizard step. The cache is also the lookup the server uses during the "not found" hand-off: a cache hit is the signal that the source group is reachable on `spliit.app`. No DB, no Redis; per-process with a short TTL.
- Add a "not found" trigger: when a user navigates to a group URL that does not exist on the new domain, the server signals `IMPORTABLE` to the web app, which routes the user into the import wizard at the **destination step** with the source already pre-filled. The user still has to walk the rest of the wizard (preview, mapping, confirm). Imported groups get a **fresh cloud group id** (the source id is recorded in the activity feed, not reused as the destination id) so destination ids stay short and unpredictable.
- Extend `LedgerParticipant` with a `kind` (`ACCOUNT_MEMBER` / `UNLINKED_PARTICIPANT`) and a `displayName` so imported groups can host named-but-unlinked people that have no app account. Unlinked entries are durable and can be linked to an account later by an owner/admin.
- Surface the "import" entry point on the signed-in homepage next to the create-group action. The actual route lives at `/groups/import`.

## Capabilities

### New Capabilities

- `spliit-import`: Web-driven import wizard plus the single `groups.import` server procedure. The web parses Spliit JSON, Spliit CSV, and (best-effort) a `spliit.app` group URL into the in-memory shape the server expects.
- `import-participant-mapping`: Per-source-participant decision (link to account, unlink by name, skip) carried in the import batch and applied during the server-side commit.

### Modified Capabilities

- `group-membership`: Defines how unlinked `LedgerParticipant` entries coexist with authenticated members without granting app access.
- `expenses`: Defines how imported and later edited expenses may reference unlinked participant entries.
- `cloud-group-sync`: Imported groups (new or existing) are normal cloud groups after import and use the same online source-of-truth path.

## Impact

- API: one new protected procedure (`groups.import`) and one helper (`importGroup`) that does the transactional write. No new tRPC routers beyond extending `groups`. Minimal server surface.
- Web: one new route (`/groups/import`), a wizard with five steps (source, preview, mapping, confirm, done), and per-source parsers (JSON, CSV, optional URL).
- Database: minimal schema additions. `LedgerParticipant` gains `kind` (enum) and `displayName`. No new import-specific tables.
- Domain: minor — reuse the existing `groupFormSchema` and `expenseFormSchema` for the batch payload.
- Operations/legal: URL-based Spliit import remains best-effort; exported JSON/CSV is the reliable path. No scraping of private data; documents are imported as URL references unless the user re-uploads them.
- Roadmap dependency: depends on `add-accounts-cloud-group-sync`; the key distinction is that only authenticated accounts can use the app, while unlinked `LedgerParticipant` entries can exist as expense parties without access.

## ADDED Requirements

### Requirement: Web-driven import wizard

The system SHALL let an authenticated user import an existing Spliit group through a single in-browser wizard. The wizard runs entirely in the web app; the server SHALL NOT persist any import wizard state. The wizard has six steps in order: **source → destination → preview → mapping → confirm → done**.

#### Scenario: User opens the wizard

- **WHEN** an authenticated user navigates to the import entry point
- **THEN** the web app shows the source step of the wizard

#### Scenario: Wizard state lives in the browser

- **WHEN** the user walks the wizard through source, destination, preview, mapping, confirm, and done
- **THEN** every step's data is held in client memory; no server endpoint is called until the user confirms

#### Scenario: Destination step is mandatory

- **WHEN** the user reaches the destination step
- **THEN** the user must pick either "new group" or "import into existing group" before proceeding

#### Scenario: Skip source step on the not-found hand-off

- **WHEN** the user arrives at the wizard with `?source=<encoded sourceUrl>` (set by the not-found hand-off)
- **THEN** the wizard opens on the destination step with the source already pre-filled

### Requirement: Spliit source formats

The system SHALL accept a Spliit group import from a `spliit.app` group URL, an exported JSON file, or an exported CSV file.

#### Scenario: Import from exported JSON

- **WHEN** the user uploads a Spliit exported JSON file
- **THEN** the web app parses it and shows the preview

#### Scenario: Import from exported CSV

- **WHEN** the user uploads a Spliit exported CSV file
- **THEN** the web app parses it and shows the preview

#### Scenario: Import from a `spliit.app` URL

- **WHEN** the user pastes a reachable `spliit.app` group URL
- **THEN** the web app asks the server-side URL proxy to fetch the source
- **THEN** the server fetches the export JSON, parses it, and returns the parsed source
- **THEN** the web app shows the preview

#### Scenario: URL import fails

- **WHEN** the user pastes a `spliit.app` group URL that the server cannot fetch or parse
- **THEN** the web app surfaces a clear error and offers the JSON/CSV fallback without losing the wizard state

### Requirement: Server-side URL proxy

The web app SHALL NOT fetch `spliit.app` directly. The server SHALL expose a proxy endpoint that fetches the source on behalf of the web app, applies an access policy / rate limit, and returns the parsed source.

#### Scenario: Wizard fetches a URL via the proxy

- **WHEN** the user enters a `spliit.app` group URL in the wizard's source step
- **THEN** the web app calls the server proxy and shows the parsed result
- **THEN** no request to `spliit.app` originates from the browser

#### Scenario: Proxy rate-limits abusive callers

- **WHEN** a caller hits the proxy endpoint excessively
- **THEN** the server rejects the call with a clear error and does not forward the request to `spliit.app`

### Requirement: In-memory source cache

The server SHALL keep a simple in-memory cache of source payloads keyed by the source group id. The cache is the single source of truth for "is this source group known to us on `spliit.app`?" and is consulted by both the URL proxy and the not-found hand-off.

#### Scenario: Cache hit avoids re-fetch

- **WHEN** the URL proxy is called for a source group id that is already in the cache
- **THEN** the proxy returns the cached parsed payload without calling `spliit.app`

#### Scenario: Cache miss fetches and populates

- **WHEN** the URL proxy is called for a source group id that is not in the cache
- **THEN** the proxy fetches the source from `spliit.app`
- **THEN** on success the proxy stores the parsed payload in the cache and returns it
- **THEN** on failure the proxy returns `NOT_FOUND` or `ERROR` and does not cache anything

#### Scenario: Cache TTL bounds staleness

- **WHEN** a cached source payload exceeds its TTL
- **THEN** the next proxy call for the same source group id re-fetches from `spliit.app`

### Requirement: Import preview before commit

The system SHALL let the user review the parsed group, participants, and expenses before submitting the import.

#### Scenario: Preview renders parsed data

- **WHEN** the source is parsed
- **THEN** the web app shows the group name and currency, the list of source participants, and the list of source expenses

#### Scenario: Validation issues shown in preview

- **WHEN** the parsed payload has shape or split-math issues
- **THEN** the web app surfaces them in the preview and blocks the user from moving to mapping or commit until they are resolved

### Requirement: Single batch submit and atomic commit

The system SHALL submit the import as a single batch and the server SHALL create the destination group, ledger, account-backed participants, unlinked participants, and imported expenses in one transaction.

#### Scenario: User confirms the import

- **WHEN** the user confirms the wizard with valid mappings
- **THEN** the web app sends a single batch payload to the server
- **THEN** the server creates the group and imported data transactionally
- **THEN** the server returns the new (or existing) group id

#### Scenario: New group from import

- **WHEN** the user submits a batch with `groupFormValues`
- **THEN** the server creates a new cloud group owned by the importer

#### Scenario: Existing group from import

- **WHEN** the user submits a batch with `targetGroupId`
- **THEN** the server creates the imported participants and expenses inside the existing group
- **THEN** the server does not create a new group or ledger

#### Scenario: Server-side validation

- **WHEN** the batch payload fails Zod validation
- **THEN** the server rejects the call with a clear input error and creates no data

#### Scenario: Destination group id is fresh

- **WHEN** the server commits the import
- **THEN** the destination group id is a fresh opaque id, NOT the source group id
- **THEN** the server records an activity entry that references the source provider and source group id for traceability

### Requirement: All-or-nothing import

The import is all-or-nothing: every expense in the parsed source is imported, or the import fails. The wizard SHALL NOT offer per-expense skip; per-participant skip is the only available skip granularity, and the web app drops `SKIP` participants from `paidBy` / `paidFor` before submitting the batch.

#### Scenario: No per-expense skip in the wizard

- **WHEN** the user is on the mapping step
- **THEN** the wizard exposes per-participant controls (link / unlink / skip) only
- **THEN** the wizard does not surface a per-expense checkbox or filter

#### Scenario: User wants to drop a single expense

- **WHEN** the user wants to exclude a single expense from the import
- **THEN** the user imports the full source and deletes the unwanted expense from the cloud group after commit

### Requirement: Imported groups use the existing cloud source-of-truth

The system SHALL treat an imported group (new or merged into an existing one) as a normal cloud group after commit.

#### Scenario: Imported group is a normal group

- **WHEN** an import commits successfully
- **THEN** the destination group appears in the user's group list, supports the normal membership / invitation / expense flows, and is visible in the account-level overview

### Requirement: No new unlinked participants after import

The system SHALL NOT allow users to create brand-new unlinked participant entries outside of an import commit.

#### Scenario: New expense in an imported group

- **WHEN** a user creates a new expense in an imported group
- **THEN** the user can select unlinked participant entries that were created during import

#### Scenario: Attempt to add a new unlinked participant

- **WHEN** a user attempts to add a brand-new unlinked participant after import (through invite, member management, or any other path)
- **THEN** the system does not surface an unlinked-creation affordance

### Requirement: "Group not found" hand-off into the import wizard

When an authenticated user navigates to a group URL that does not exist on the new domain, the server SHALL try the configured import providers and, if a matching source group is found, signal the intent to import to the web app. The web app SHALL route the user into the import wizard at the **destination step** with the source pre-filled.

#### Scenario: Local group exists

- **WHEN** the user navigates to a group URL that exists locally
- **THEN** the system shows the group (no import prompt)

#### Scenario: Local missing, source exists on a configured provider

- **WHEN** the user navigates to a group URL that does not exist locally
- **AND** the server finds a matching source group on a configured import provider (e.g. `spliit.app`)
- **THEN** the server returns a structured `IMPORTABLE` response with the `sourceProvider` and `sourceUrl`
- **THEN** the web app routes the user to `/groups/import?source=<encoded sourceUrl>` with the wizard opened on the **destination step** (the source step is skipped because the source is pre-filled)
- **THEN** the user still has to walk the preview, mapping, and confirm steps before the import is committed

#### Scenario: Local missing, source also missing

- **WHEN** the user navigates to a group URL that does not exist locally
- **AND** the server cannot find the source on any configured import provider
- **THEN** the server returns a normal not-found response
- **THEN** the web app shows the existing group-not-found page

#### Scenario: In-memory cache short-circuits the lookup

- **WHEN** the user navigates to a group URL that does not exist locally
- **AND** the source group id is in the server's in-memory source cache
- **THEN** the server returns `IMPORTABLE` without re-fetching from `spliit.app`

#### Scenario: Imported group has a fresh destination id

- **WHEN** the user confirms an import that started from the "not found" hand-off
- **THEN** the destination group is created with a fresh cloud group id, not the source id
- **THEN** the source id is preserved in the destination group's activity feed

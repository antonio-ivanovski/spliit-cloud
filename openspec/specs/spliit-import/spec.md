## Purpose

Defines how users import an existing Spliit group (or a group exported from another expense-splitting app) into Spliit Cloud. Covers the in-browser import wizard, the server-side commit that creates or merges a destination group, cross-currency conversion, and source-URL attribution.
## Requirements
### Requirement: Web-driven import wizard

The system SHALL let an authenticated user import an existing Spliit group through a single in-browser wizard. The wizard runs entirely in the web app; the server SHALL NOT persist any import wizard state. The wizard has five steps in order: **source → destination → mapping → confirm → done**.

#### Scenario: User opens the wizard

- **WHEN** an authenticated user navigates to the import entry point
- **THEN** the web app shows the source step of the wizard

#### Scenario: Wizard state lives in the browser

- **WHEN** the user walks the wizard through source, destination, mapping, confirm, and done
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

The import is all-or-nothing: every expense in the parsed source is imported, or the import fails. The wizard SHALL NOT offer per-expense skip. Per-participant options (link to me, invite by email, invite by link, link to existing member, leave unlinked) are the only available granularity.

#### Scenario: No per-expense skip in the wizard

- **WHEN** the user is on the mapping step
- **THEN** the wizard exposes per-participant controls (link to me / invite by email / invite by link / link to existing member / leave unlinked) only
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

### Requirement: Source step lists available providers

The source step SHALL present a tabbed UI with "From Spliit" (active by default) and "From Splitwise" as provider tabs that have full file-upload flows, and "Tricount" and "Settle Up" as "coming soon" tabs. The Spliit tab exposes drag-and-drop file upload (JSON/CSV) and a URL paste input for `spliit.app` group URLs. The Splitwise tab exposes drag-and-drop file upload for `.csv` only.

The file handler dispatches the parser based on the **active provider tab and the file extension** (via `pickParser(provider, fileName)` driven by a per-provider `PROVIDERS` config table). It does NOT auto-detect the file format by header shape and does NOT brute-force both parsers. Each parser still validates its own header strictly and returns `{ ok: false }` when the file does not match its expected format; the source step surfaces that error and does not advance.

#### Scenario: Spliit tab shows file upload and URL input

- **WHEN** the user opens the source step
- **THEN** the Spliit tab is active by default and shows drag-and-drop file upload (JSON/CSV) and a URL paste input for `spliit.app` group URLs

#### Scenario: Splitwise tab shows file upload

- **WHEN** the user selects the Splitwise tab
- **THEN** the Splitwise tab shows drag-and-drop file upload for `.csv` files (accept attribute restricts to `.csv,text/csv`)
- **AND** the tab does NOT show a "coming soon" placeholder card

#### Scenario: Drop zone works on the Splitwise tab

- **WHEN** the user drags a `.csv` file over the Splitwise tab's drop zone
- **THEN** the drop zone is highlighted and the file is accepted

#### Scenario: Wrong format on the active tab is rejected

- **WHEN** the user drops a file whose extension does not match the active provider's accepted types (e.g. a `.json` on the Splitwise tab, a `.txt` on the Spliit tab)
- **THEN** `pickParser` returns `{ format: null }`, the source step surfaces the `unsupportedFileType` error, and the wizard does not advance

#### Scenario: Wrong shape on the active tab is rejected

- **WHEN** the user drops a CSV whose header does not match the active provider's expected parser (e.g. a Spliit-shaped CSV on the Splitwise tab)
- **THEN** the parser returns `{ ok: false }` with a clear header-mismatch error, the source step surfaces that error, and the wizard does not advance

#### Scenario: Tricount and Settle Up remain coming soon

- **WHEN** the user selects the Tricount or Settle Up tab
- **THEN** the UI renders a card with a clock icon and a localized "coming soon" message

### Requirement: Cross-currency import

When the source group's currency differs from the destination ledger's currency, the system SHALL convert each affected expense into the destination currency using a real exchange rate from the Frankfurter provider, and SHALL preserve the source-currency values alongside the converted amount so the conversion is auditable.

#### Scenario: Currencies differ uses a real exchange rate from Frankfurter

- **WHEN** the source currency code differs from the destination ledger currency code
- **THEN** the wizard fetches an exchange rate from the API proxy for each unique `(date, source, destination)` tuple across the resolved expenses
- **AND** each imported expense has `originalAmount` set to the source-currency amount, `originalCurrency` set to the effective source currency code, `conversionRate` set to the rate returned by the provider for the expense's date, and `amount` set to `round(originalAmount * conversionRate)` in destination-currency minor units

#### Scenario: Per-expense prior conversion is preserved across groups

- **WHEN** a source expense already carries `originalAmount` and `originalCurrency` from a prior USD→EUR conversion (the source group is EUR) and the destination ledger is GBP
- **THEN** the import treats USD as the effective source currency for that expense, fetches a USD→GBP rate for the expense's date, and writes `originalAmount`, `originalCurrency: USD`, the USD→GBP `conversionRate`, and the converted `amount` in GBP minor units

#### Scenario: Same-currency import passes through unchanged

- **WHEN** the source and destination currency codes match
- **THEN** each imported expense preserves any `originalAmount`, `originalCurrency`, and `conversionRate` from the source export and `amount` is left in the destination ledger's currency without further conversion

#### Scenario: No prior conversion in same-currency import

- **WHEN** the source and destination currency codes match and the source expense has no `originalAmount`/`originalCurrency`/`conversionRate`
- **THEN** `originalAmount`, `originalCurrency`, and `conversionRate` are all absent on the imported expense

#### Scenario: Cross-currency import blocks when the rate provider is unavailable

- **WHEN** the source and destination currency codes differ and the API proxy returns an error for any required rate (unsupported currency, rate not found, provider error, invalid date)
- **THEN** the confirm step displays the failure and disables the import button until the user retries; the import mutation is never sent

### Requirement: Source URL attribution

The system SHALL preserve the source group URL in the `NormalizedSource.sourceUrl` field and SHALL compose an "Imported from:" note using the `appendImportedFromNote` helper.

#### Scenario: Source URL pre-fills the group information field

- **WHEN** the user chooses to create a new group and the source has a `sourceUrl`
- **THEN** the destination step pre-fills the group information text area with `Imported from: <sourceUrl>` (produced by `appendImportedFromNote`)

#### Scenario: Source URL is recorded in the import activity entry

- **WHEN** the wizard submits an import batch with `sourceMeta.sourceUrl`
- **THEN** the server records an activity entry containing the source provider, source group id, and source URL for traceability

#### Scenario: CSV import has no source URL

- **WHEN** the source is parsed from a CSV file
- **THEN** `sourceUrl` is `null` and no attribution note is generated


## Purpose

Defines legacy Spliit JSON and CSV import: the immutable legacy expense shape accepted at the API boundary, recurrence collapse for historical JSON rows, document recovery for JSON and URL imports, the CSV recurrence and document limitations, and the exact-once conversion of legacy BY_SHARES weights into fixed units.

## Requirements

### Requirement: Legacy share weights convert to fixed units
The Spliit JSON import SHALL convert legacy BY_SHARES whole-number weights to fixed units exactly once, by multiplying each weight by 100 while preserving the split's ratios (`1 : 3` stays `1 : 3` as `100 : 300`). The conversion SHALL be mode-gated: rows whose `splitMode` is not BY_SHARES SHALL pass through unchanged. The import SHALL NOT guess or detect a representation at runtime — legacy exports always carry whole-number share weights, so scaling is applied deterministically on the BY_SHARES path only.

#### Scenario: BY_SHARES weights scale exactly once
- **WHEN** an imported legacy expense has `splitMode = BY_SHARES` with whole weights
- **THEN** each weight is multiplied by 100 during import and is never scaled again on any later read or write path

#### Scenario: Import preserves ratios
- **WHEN** a legacy split has weights `1` and `3`
- **THEN** the imported fixed units are `100` and `300`, keeping the exact `1 : 3` allocation ratio

#### Scenario: Other modes pass through unchanged
- **WHEN** an imported expense uses BY_AMOUNT, BY_PERCENTAGE, EVENLY, or ITEMIZED
- **THEN** its shares are imported without scaling, matching the pre-existing storage unit of that mode

#### Scenario: No runtime scale guessing
- **WHEN** the import reads a BY_SHARES expense
- **THEN** it applies the fixed `× 100` conversion from the mode declaration alone, without inferring the scale from the magnitude of the values

### Requirement: Legacy JSON recurring import collapse
The Spliit JSON import commit path SHALL collapse matching historical `recurrenceRule` rows into one `RecurringExpenseSeries` before creating expenses, using the same conservative fingerprint as legacy recurrence migration for link-less rows (title, recurrence rule, amount, split mode, settlement category / legacy `isReimbursement` alias, sorted paid-by and paid-for participant shares, original currency, conversion rate). Overdue skip SHALL set `nextOccurrenceDate` and `nextOccurrenceOrdinal` with anchored occurrence math (same as materialization), not iterative next-from-previous stepping.

#### Scenario: Confirm summary matches collapsed series
- **WHEN** the user reaches the import confirm step and the parsed batch contains recurring JSON rows
- **THEN** the summary lists one entry per collapsed series with expense title and human-readable cadence (Daily, Weekly, or Monthly), not one entry per historical occurrence

#### Scenario: Collapse planner matches server commit
- **WHEN** the user confirms a JSON import with recurring rows
- **THEN** the web confirm summary and the server `importGroup` commit use the same collapse planner so listed schedules match created series

#### Scenario: Import overdue skip uses anchored ordinals
- **WHEN** imported historical rows are entirely before the current UTC calendar day and the anchor is on a month-end or leap day
- **THEN** the created series sets `nextOccurrenceDate` and `nextOccurrenceOrdinal` from anchored occurrence math so the worker can materialize the next occurrence

### Requirement: Spliit CSV recurrence limitation
The legacy Spliit CSV wire format SHALL NOT carry recurrence. The CSV parser SHALL set every row to non-recurring and SHALL reject headers that match Cloud recurrence columns.

#### Scenario: CSV import has no recurring schedules
- **WHEN** the user imports a legacy Spliit CSV file
- **THEN** no `RecurringExpenseSeries` rows are created and the confirm summary omits the recurring-schedules list

#### Scenario: Source step discloses JSON for recurrence
- **WHEN** the user is on the Spliit source step with file upload enabled
- **THEN** the UI states that CSV exports do not include recurrence and that JSON export from spliit.app is required to import recurring expenses

### Requirement: Legacy import API transport boundary
The `groups.import` mutation SHALL accept only the immutable legacy spliit.app expense shape. Internal Cloud `recurrence` objects, series identifiers, and sequence numbers SHALL be stripped at the API boundary and SHALL NOT influence series creation.

#### Scenario: Cloud recurrence fields stripped on import
- **WHEN** an import payload includes Cloud recurrence metadata alongside legacy fields
- **THEN** the server ignores the Cloud recurrence object and maps recurrence only from `recurrenceRule` when it is not `NONE`

### Requirement: Spliit document recovery
Spliit JSON and URL imports SHALL offer an optional document-recovery step after currency conversion. The step SHALL discover source documents, fetch them through the server's bounded proxy, resize them to JPEGs no larger than 2 MiB, and stage them in account- and import-session-scoped temporary object storage. Spliit CSV imports SHALL skip this step because their source format does not provide source-document identifiers.

#### Scenario: JSON or URL import includes the Documents step
- **WHEN** an authenticated user imports a Spliit JSON file or URL
- **THEN** the wizard presents a Documents card with an include-documents checkbox and a Continue action
- **AND** continuing with the checkbox selected discovers and stages recoverable documents before showing Confirm

#### Scenario: CSV import skips document recovery
- **WHEN** an authenticated user imports a Spliit CSV file
- **THEN** currency conversion continues directly to Confirm and the wizard does not show the Documents step or document counts

#### Scenario: User explicitly skips documents
- **WHEN** the user clears the include-documents checkbox and continues
- **THEN** the import records an explicit full skip, proceeds to Confirm, and does not request source documents

#### Scenario: Discovery has no recoverable documents
- **WHEN** document discovery returns no documents or fails completely
- **THEN** the Documents step shows an inline retry/continue-without-documents state and does not block the user from continuing without documents

#### Scenario: Some documents fail recovery
- **WHEN** discovery or staging recovers some documents but one or more documents fail
- **THEN** the wizard presents a stop/retry choice and a continue-with-missing-documents choice in a modal
- **AND** continuing with missing documents preserves the successfully staged documents and records the failed count in the Confirm summary

### Requirement: Document discovery matching and bounded proxy
Document discovery SHALL match source documents to expenses using `sourceCreatedAt` and title, and SHALL fail closed when a match is ambiguous. Source and staged claims SHALL be encrypted or signed and bound to the authenticated account and import session. The proxy SHALL validate the upstream response, reject private or link-local destinations including IPv4-mapped IPv6 forms, reject unsafe redirects, and enforce bounded response sizes and timeouts; permanent upstream document URLs SHALL NOT be stored in the import payload.

#### Scenario: Ambiguous source match is not imported
- **WHEN** more than one source expense can match a discovered document
- **THEN** the document is reported as missing rather than attached to an arbitrary expense

#### Scenario: Unsafe source or redirect is rejected
- **WHEN** a source URL or redirect resolves to a private, loopback, link-local, benchmark, carrier-grade NAT, or IPv4-mapped private address
- **THEN** the proxy rejects the document and the wizard reports it as missing

#### Scenario: Invalid document bytes are rejected
- **WHEN** the proxied response is not an accepted image or exceeds the configured response limit
- **THEN** the document is not staged or attached to the import

### Requirement: Atomic and retry-safe document attachment
The import commit SHALL attach each successfully staged document to its matched imported expense in the same database transaction as the imported group and expenses. Promotion SHALL occur only after import preflight succeeds. Temporary objects SHALL remain available until the database commit succeeds, and promotion SHALL be idempotent: a retry SHALL accept an existing validated permanent object when the temporary object has already been removed. If preparation or database commit fails, successfully promoted objects SHALL be compensated while temporary objects remain available for retry.

#### Scenario: Imported expenses receive matched documents
- **WHEN** an import commits with staged document claims
- **THEN** each matched expense is created with its document attachment and the response reports the number of imported documents

#### Scenario: Preflight failure does not orphan permanent objects
- **WHEN** target-group validation, conversion preparation, or another preflight operation fails
- **THEN** no permanent document copy is left behind and staged temporary objects remain retryable

#### Scenario: Database failure preserves retryability
- **WHEN** the database transaction fails after document promotion
- **THEN** promoted permanent copies are compensated, temporary objects are retained, and retrying with the same staged tokens remains possible

#### Scenario: Replayed import is idempotent
- **WHEN** the same import request is retried after a successful commit
- **THEN** the existing idempotent import result is returned without duplicating expenses or document attachments, even if temporary objects were already deleted

### Requirement: Document staging lifecycle
Successful imports SHALL delete their temporary staged objects after commit. Abandoned or interrupted staged objects SHALL be bounded by an object-storage lifecycle rule that expires the `tmp/imports/` prefix after 24 hours. The wizard SHALL return document-staging failures to the Documents step; it SHALL retain reusable staged tokens and completed recovery state for retry, and SHALL clear them only when the server reports that the tokens are invalid/expired or unavailable.

#### Scenario: Reusable staging failure returns to Documents
- **WHEN** import validation fails for a reason other than token expiry or object unavailability
- **THEN** the user returns to Documents with the existing staged tokens and recovered counts intact

#### Scenario: Expired staging can be recovered
- **WHEN** the server reports that staged tokens are invalid, expired, or unavailable
- **THEN** the wizard clears those staged results and lets the user run document recovery again

### Requirement: Document-aware wizard navigation
Wizard navigation labels SHALL reflect whether the Documents step is active or has been visited. When document recovery is unsupported or skipped, Currency conversion SHALL link directly to Confirm and Confirm SHALL link back to Currency conversion. When document recovery is active, labels SHALL refer to Documents. The Spliit source tab SHALL not display the legacy receipt-not-imported warning; provider-specific receipt warnings MAY remain for providers whose exports lack documents.

#### Scenario: Navigation omits skipped Documents
- **WHEN** the source is Splitwise or Spliit CSV, or a Spliit document flow has not been visited
- **THEN** the Currency conversion Continue label names Confirm and the Confirm Back label names Currency conversion

#### Scenario: Navigation includes visited Documents
- **WHEN** a supported Spliit JSON or URL import has visited the Documents step
- **THEN** the Confirm Back label names Documents

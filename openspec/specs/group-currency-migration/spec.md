## Purpose

Define the safe, direct, ISO-only migration of an existing group ledger to a new supported currency.

## Requirements

### Requirement: ISO-only migration eligibility

The system SHALL allow currency migration only when the old ledger currency, selected destination currency, and every expense’s effective original currency are ISO currencies supported by the application’s rate provider. The migration preview SHALL report unsupported currencies and affected expenses before the user can configure rates, and the mutation SHALL repeat this validation.

An expense’s effective original currency is its `originalCurrency` when set; otherwise it is the old ledger currency. A previously same-currency expense uses its current `amount` as its effective original amount; an already converted expense uses `originalAmount`.

#### Scenario: Unsupported original currency blocks migration

- **WHEN** a group contains an expense whose `originalCurrency` is a non-ISO or application-unsupported code
- **THEN** the preview SHALL mark the migration ineligible
- **AND** it SHALL identify that currency and affected expense count
- **AND** the user SHALL NOT be able to configure a fallback fixed/custom rate or submit the migration

#### Scenario: Unsupported old or destination currency blocks migration

- **WHEN** the old ledger currency or selected destination currency is non-ISO or unsupported
- **THEN** the system SHALL reject the migration before any expense is rewritten

### Requirement: Group currency migration entry point

The system SHALL let a group ADMIN initiate a guided currency migration from settings when the group has expenses. The migration runs at `/groups/$groupId/edit/currency-migration`. Non-admins and archived groups SHALL be refused and SHALL not receive migration data.

#### Scenario: Settings migration action for a group with expenses

- **WHEN** an ADMIN opens settings for a group that has one or more expenses
- **THEN** the vertical Group information section SHALL show the currency as a read-only currency identity, not a disabled selector
- **AND** the page SHALL render a “Migrate currency” action to the migration route

#### Scenario: Direct migration URL renders its own page

- **WHEN** an ADMIN opens `/groups/$groupId/edit/currency-migration`
- **THEN** the migration wizard SHALL render
- **AND** the group settings tab SHALL NOT replace the migration page

#### Scenario: No-expense group remains directly editable

- **WHEN** an ADMIN opens settings for a group with no expenses
- **THEN** the current currency SHALL initially be a read-only identity with a “Change currency” action
- **AND** that action SHALL reveal the ordinary editable currency selector and Save action
- **AND** no migration flow SHALL be required

### Requirement: Direct-pair rate resolution and preview

The migration SHALL group expenses by each distinct direct `effective original currency → destination currency` pair. The user SHALL choose one resolution policy for each pair, using the shared currency-conversion wizard controls also used by import:

- **per expense date**: a provider rate for every affected expense date;
- **fixed provider rate**: one provider rate fetched for a user-selected date; or
- **fixed custom rate**: one user-entered positive numeric rate.

The browser SHALL preview the selected policy and resolved rates before confirmation. The policy cards SHALL use the application’s `RadioGroup` and `RadioGroupItem` controls. The confirmation SHALL show Applied exchange rates grouped by direct pair and date; it SHALL NOT show simulated per-expense conversions or converted totals. It is informational, not authoritative.

#### Scenario: Current currency is initially selected

- **WHEN** an ADMIN opens the migration page
- **THEN** the destination selector SHALL show the current group currency
- **AND** the page SHALL ask the ADMIN to select a different supported currency before preflight starts

#### Scenario: No conversion rates are needed

- **WHEN** every expense is already in the selected destination currency
- **THEN** the migration flow SHALL state that no conversion is needed
- **AND** the review SHALL omit Applied exchange rates and the provider re-resolution notice

#### Scenario: Existing foreign expense is repriced directly

- **WHEN** a EUR expense was previously converted into a USD ledger and the group migrates to GBP
- **THEN** it SHALL belong to an `EUR → GBP` pair
- **AND** no EUR→USD rate or USD→GBP leg SHALL be presented or used

#### Scenario: Previously same-currency expense becomes a direct pair

- **WHEN** an expense has no original currency in a USD ledger migrating to GBP
- **THEN** it SHALL belong to a `USD → GBP` pair
- **AND** its current amount SHALL be used as the preview’s original amount

#### Scenario: Fixed provider rate preview

- **WHEN** the user selects a fixed provider rate and date for a pair
- **THEN** the browser SHALL show the provider rate for that date and use it for every affected preview conversion

#### Scenario: Fixed custom rate preview

- **WHEN** the user enters a fixed custom rate for a pair
- **THEN** the browser SHALL validate it is positive and finite and use it for every affected preview conversion

### Requirement: Existing custom rates are discarded with a warning

The migration SHALL never preserve, map, compose, or otherwise reuse existing `conversionRate` values. If affected expenses have `conversionSource = CUSTOM`, the confirmation SHALL warn that their historical custom currency rates will be discarded and totals may change.

#### Scenario: Existing custom EUR to USD rate is discarded

- **WHEN** an expense has an existing custom EUR→USD conversion and the group migrates USD→GBP
- **THEN** the new conversion rate SHALL be resolved solely from the user’s chosen EUR→GBP policy
- **AND** the confirmation SHALL warn that the prior custom rate is discarded

### Requirement: Server-authoritative final rate resolution

The client SHALL send pair policies, selected fixed-provider dates, and fixed custom rates, but not authoritative provider rates. On submission, the server SHALL re-fetch all provider-backed rates and calculate the final conversion fields. If server rates differ from preview rates, the server values SHALL be committed.

#### Scenario: Provider-backed preview is refreshed on commit

- **WHEN** a user confirms a per-date or fixed-provider policy
- **THEN** the mutation SHALL fetch provider rates server-side for every required date and pair
- **AND** it SHALL NOT trust preview rates supplied by the client

#### Scenario: Provider failure prevents migration

- **WHEN** a server-side provider lookup fails
- **THEN** the mutation SHALL fail with a provider error before any write commits
- **AND** all expense and ledger values SHALL remain unchanged

### Requirement: Atomic direct repricing

The migration mutation SHALL atomically update the ledger currency and only each expense’s `amount`, `originalAmount`, `originalCurrency`, `conversionRate`, and `conversionSource`. It SHALL not modify paid-by/paid-for or item rows.

Provider-backed direct results SHALL store `conversionSource = EXCHANGE`; fixed provider and fixed custom results SHALL store `conversionSource = CUSTOM`.

#### Scenario: Converted expense retains its original input

- **WHEN** a EUR expense with `originalAmount` migrates to GBP using direct rate `r`
- **THEN** `originalAmount` and `originalCurrency` SHALL remain unchanged
- **AND** `conversionRate` SHALL become `r`
- **AND** `amount` SHALL become the rounded direct EUR→GBP conversion

#### Scenario: Same-currency expense is converted without changing splits

- **WHEN** a USD-ledger expense migrates to GBP
- **THEN** its old amount and USD code SHALL become `originalAmount` and `originalCurrency`
- **AND** all share and item rows SHALL remain byte-for-byte unchanged

### Requirement: Migration confirmation and audit

Before submitting, the migration page SHALL summarize all pairs, policies, applied rates by pair/date when rates are needed, warnings, and an irreversible-action acknowledgement. A successful mutation SHALL record one activity event with the actor, old currency, and new currency in the same transaction. After success, the client SHALL reset cached group, settings, expense-list, expense-detail, balance, stats, activity, and account-group data before navigating to settings.

#### Scenario: Acknowledgement is required

- **WHEN** a user reaches confirmation
- **THEN** the Migrate action SHALL remain disabled until the irreversible warning is acknowledged

#### Scenario: Previously opened expense reflects migration immediately

- **WHEN** an ADMIN migrates a group and later opens an expense that was cached before the migration
- **THEN** the expense detail SHALL fetch its post-migration data
- **AND** it SHALL NOT render the old amount before refresh

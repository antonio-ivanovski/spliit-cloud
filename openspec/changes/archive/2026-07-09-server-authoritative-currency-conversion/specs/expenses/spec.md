## ADDED Requirements

### Requirement: Converted expense input preservation
The system SHALL accept expense monetary inputs in the selected expense currency via a discriminated `conversion` field (`none` | `custom` | `exchange`), persist flat conversion columns, and compute ledger-currency totals server-side.

#### Scenario: Create expense with exchange conversion
- **WHEN** a user creates an expense with `conversion: { type: 'exchange', currency }` against a different supported ISO ledger currency
- **THEN** the client submits expense-currency `amount` and the conversion discriminant; the server resolves the rate, persists `conversionSource = EXCHANGE`, original amount/currency, rate, and the server-computed ledger total

#### Scenario: Create expense with custom conversion
- **WHEN** a user creates an expense with `conversion: { type: 'custom', currency, rate }`
- **THEN** the server applies that rate and persists `conversionSource = CUSTOM` with original amount/currency and ledger total

#### Scenario: Create same-currency expense
- **WHEN** a user creates an expense without a `conversion` field (group currency)
- **THEN** the server persists `conversionSource = null`, null rate/original fields, and the amount as ledger minor units

#### Scenario: Update converted expense
- **WHEN** a user updates amount, currency, conversion type/rate, date, or amount-based splits
- **THEN** the server recomputes ledger total and conversion columns from the submitted conversion discriminant

#### Scenario: Display converted expense
- **WHEN** a user views a converted expense
- **THEN** the UI can show original amount, conversion source (exchange/custom), rate, and ledger amount
- **AND** there is no separate provider as-of field required for display or audit

### Requirement: Conversion source selection in the UI
The system SHALL let users choose exchange or custom conversion when currencies differ, map that choice to the conversion discriminant on submit, and restore the correct UI from `conversionSource` on edit.

#### Scenario: Switch to custom rate
- **WHEN** a user uses the custom-rate action
- **THEN** the form sets conversion type `CUSTOM` and requires a positive rate

#### Scenario: Switch to exchange rate
- **WHEN** a user uses the exchange-rate action
- **THEN** the form sets conversion type `EXCHANGE`, previews a rate, and does not open the custom rate input on reopen after save

#### Scenario: Exchange rate wording
- **WHEN** the exchange option is shown
- **THEN** the label uses localized “exchange rate” copy and a small Frankfurter attribution note

### Requirement: Converted expense previews
Client-side converted amounts are illustrative only; the server is the persistence authority.

#### Scenario: Future date uses today rate messaging
- **WHEN** the expense date is in the future and conversion type is `exchange`
- **THEN** preview and save use today's rate and the UI discloses this

### Requirement: Server-side import conversion
Import sends expense-currency amounts and a conversion discriminant; the server resolves conversion with the same rules as create.

#### Scenario: Import with exchange rates
- **WHEN** an import batch uses per-date exchange rates
- **THEN** each expense is submitted with `conversion.type = 'exchange'` and expense-currency amounts; the server resolves rates and stores ledger totals

#### Scenario: Import with fixed custom rates
- **WHEN** an import batch uses fixed rates
- **THEN** each expense is submitted with `conversion.type = 'custom'` including the rate

## ADDED Requirements

### Requirement: Converted expense input preservation
The system SHALL accept and store expense monetary inputs in the selected expense currency, persist `conversionSource` and rate metadata, and compute ledger-currency totals server-side for accounting.

#### Scenario: Create expense with exchange conversion
- **WHEN** a user creates an expense in a different supported ISO currency than the Ledger base with `conversionSource` `EXCHANGE`
- **THEN** the client submits the entered amount, selected currency, `conversionSource`, split/item inputs, and expense date; the server resolves the rate, persists original-currency inputs, and stores the server-computed ledger-currency total plus rate/as-of metadata

#### Scenario: Create expense with custom conversion
- **WHEN** a user creates an expense that requires conversion with `conversionSource` `CUSTOM`
- **THEN** the client submits the entered amount, selected currency, `conversionSource`, positive custom rate, and split/item inputs; the server applies that rate and persists original-currency inputs plus the computed ledger-currency total

#### Scenario: Create same-currency expense
- **WHEN** a user creates an expense in the Ledger base currency
- **THEN** the client submits the entered amount and currency; the server persists `conversionSource` `NONE` and the amount as Ledger-currency minor units without exchange metadata

#### Scenario: Update converted expense
- **WHEN** a user updates a converted expense's entered amount, selected currency, `conversionSource`, rate (when custom), expense date, or amount-based split/item inputs
- **THEN** the server recomputes the persisted ledger-currency total and conversion metadata from the submitted original/input values and source

#### Scenario: Change expense currency during edit
- **WHEN** a user changes an expense's selected currency during edit
- **THEN** the form keeps the entered numeric amount and amount-based share/item numbers unchanged by default, reinterprets them in the newly selected currency, updates allowed conversion sources, and lets the user edit before saving

#### Scenario: Amount-split validation after currency change
- **WHEN** kept numeric paid-for share amounts do not sum to the kept numeric expense amount after an expense currency change
- **THEN** the form uses the existing amount-split validation or rebalance behavior and does not auto-adjust participant shares without user action

#### Scenario: Input currency precision
- **WHEN** a user enters an expense amount, amount-based split shares, or item prices
- **THEN** the system validates input precision using the selected expense currency decimal digits

#### Scenario: Display converted expense
- **WHEN** a user views an expense that was converted
- **THEN** the expense UI displays the original/input amount, `conversionSource`, rate (and as-of when exchange), and the ledger-currency converted amount

#### Scenario: Converted reimbursement expense
- **WHEN** a reimbursement expense requires conversion
- **THEN** the server applies the same `conversionSource`, metadata, and ledger-currency accounting rules as any other converted expense

### Requirement: Conversion source selection in the UI
The system SHALL let users choose exchange-provider or custom conversion when the expense currency differs from the ledger base, using the existing expense-form rate actions, and SHALL persist that choice as `conversionSource`. The exchange option label SHALL use localized “exchange rate” wording (not “API rate”). When the exchange option is shown, the UI SHALL display a small note that rates come from https://frankfurter.dev/ and their API.

#### Scenario: Switch to custom rate
- **WHEN** a user uses the custom-rate action for a converted expense
- **THEN** the form sets `conversionSource` `CUSTOM`, accepts a user-entered positive rate, and previews conversion using that rate

#### Scenario: Switch to exchange rate
- **WHEN** a user uses the exchange-rate action for a supported converted pair
- **THEN** the form sets `conversionSource` `EXCHANGE`, loads a preview rate from the API, and does not treat the preview as the sole persistence authority

#### Scenario: Exchange rate option wording and attribution
- **WHEN** the expense form shows the exchange conversion option
- **THEN** the action uses localized “exchange rate” copy and a small note attributes the rate source to https://frankfurter.dev/ and their API

#### Scenario: Custom currency blocks exchange source
- **WHEN** the expense or ledger currency is not a supported exchange pair
- **THEN** the UI offers custom conversion (not exchange) and the server rejects `EXCHANGE` for that pair

### Requirement: Converted expense previews
The system SHALL treat client-side converted amounts as illustrative previews and not as authoritative persisted values.

#### Scenario: Preview rate lookup
- **WHEN** a user enters a currency, amount, and date that require `EXCHANGE` conversion
- **THEN** the client requests a preview rate from the tRPC API and displays the converted estimate without making that preview authoritative

#### Scenario: Future date uses today rate messaging
- **WHEN** the expense date is in the future and `conversionSource` is `EXCHANGE`
- **THEN** the client requests today's rate for preview and displays that today's rate will be used for this future-dated expense

#### Scenario: Preview differs from persisted result
- **WHEN** the server computes a persisted conversion that differs from the client preview because the rate was refreshed or rounded differently
- **THEN** the persisted server-computed amount and rate are the source of truth

### Requirement: Server-side import conversion
The system SHALL apply conversion for imported expenses on the server. Bulk rate lookup remains available so the import UI can preview rates; the import mutation SHALL not trust client-computed ledger amounts as authoritative.

#### Scenario: Import with exchange rates
- **WHEN** an import batch includes expenses that need ISO-to-ISO conversion
- **THEN** the server resolves rates (using the same date rules as expense create) and persists original-currency inputs plus server-computed ledger totals and `conversionSource` `EXCHANGE` unless a custom rate was supplied for that row

#### Scenario: Import with custom currencies
- **WHEN** an import batch includes expenses involving custom or unsupported currencies that differ from the destination ledger currency
- **THEN** the system requires custom rates for those rows, stores `conversionSource` `CUSTOM`, and does not call the exchange provider for unsupported pairs

#### Scenario: Import preview rates
- **WHEN** the import wizard shows conversion previews
- **THEN** it may use the bulk rate API for display only while final persistence still performs server-side conversion

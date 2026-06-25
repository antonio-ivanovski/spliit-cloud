## ADDED Requirements

### Requirement: Converted expense input preservation
The system SHALL preserve the original/input currency values for converted expenses while using server-normalized Ledger-currency values for persistence and accounting.

#### Scenario: Create converted expense
- **WHEN** a user creates an expense in a currency different from the Ledger base currency
- **THEN** the client submits the entered amount, selected currency, and split inputs with the existing expense date, and the server persists the converted Ledger-currency amount and server-used conversion metadata

#### Scenario: Create same-currency expense
- **WHEN** a user creates an expense in the Ledger base currency
- **THEN** the client submits the entered amount and selected currency, and the server persists the amount as Ledger-currency minor units without conversion metadata

#### Scenario: Update converted expense
- **WHEN** a user updates a converted expense's entered amount, selected currency, existing expense date, or amount-based split inputs
- **THEN** the server recomputes the persisted Ledger-currency amount, amount-based shares, and conversion metadata from the submitted original/input values

#### Scenario: Change expense currency during edit
- **WHEN** a user changes an expense's selected currency during edit
- **THEN** the form keeps the entered numeric amount unchanged by default, reinterprets it in the newly selected currency, and lets the user edit the amount before saving

#### Scenario: Change amount-split currency during edit
- **WHEN** a user changes the selected currency for an expense using `BY_AMOUNT` splits
- **THEN** the form keeps paid-for numeric share amounts unchanged by default, reinterprets them in the newly selected currency, and lets the user edit or rebalance them before saving

#### Scenario: Amount-split validation after currency change
- **WHEN** kept numeric paid-for share amounts do not sum to the kept numeric expense amount after an expense currency change
- **THEN** the form uses the existing amount-split validation or rebalance behavior and does not auto-adjust participant shares without user action

#### Scenario: Input currency precision
- **WHEN** a user enters an expense amount or amount-based split shares
- **THEN** the system validates the input precision using the selected expense currency decimal digits before conversion

#### Scenario: Display converted expense
- **WHEN** a user views an expense that was entered in a currency different from the Ledger base currency
- **THEN** the expense UI displays both the original/input amount and the persisted Ledger-currency converted amount

#### Scenario: Converted reimbursement expense
- **WHEN** a reimbursement expense is entered in a currency different from the Ledger base currency
- **THEN** the server applies the same conversion, metadata persistence, and Ledger-currency accounting rules as any other converted expense

### Requirement: Converted expense previews
The system SHALL treat client-side converted amounts as illustrative previews and not as authoritative persisted values.

#### Scenario: Preview rate lookup
- **WHEN** a user enters an original currency, original amount, and date that require conversion
- **THEN** the client requests a preview rate from the tRPC API and displays the converted estimate without making that preview authoritative

#### Scenario: Future date preview fallback
- **WHEN** a preview rate is requested for a future expense date and the provider returns the latest available date instead
- **THEN** the client displays the preview using the returned rate and as-of date without blocking the user solely because the requested date is in the future

#### Scenario: Preview differs from persisted result
- **WHEN** the server computes a persisted conversion that differs from the client preview because the rate was refreshed or rounded differently
- **THEN** the persisted server-computed amount and rate are the source of truth

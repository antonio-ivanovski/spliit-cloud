## ADDED Requirements

### Requirement: Currency conversion export metadata
The system SHALL include server-persisted expense-level original-currency and conversion metadata in exports for converted expenses while keeping accounting amounts in Ledger base currency.

#### Scenario: Export converted expense
- **WHEN** an export includes an expense entered in a currency different from the Ledger base currency
- **THEN** the export includes the Ledger-currency amount, original amount, original currency, server-used conversion rate, and provider rate date/as-of metadata where available

#### Scenario: Original split-share metadata remains internal
- **WHEN** an export includes a converted expense with amount-based original split-share metadata
- **THEN** the export does not include per-participant original split-share metadata in the initial implementation

#### Scenario: Export same-currency expense
- **WHEN** an export includes an expense entered in the Ledger base currency
- **THEN** the export includes the Ledger-currency amount without requiring original-currency conversion metadata

## ADDED Requirements

### Requirement: Currency conversion export metadata
The system SHALL include server-persisted expense-level original-currency and conversion metadata in exports for converted expenses while keeping accounting amounts in Ledger base currency.

#### Scenario: Export converted expense
- **WHEN** an export includes a converted expense
- **THEN** the export includes the Ledger-currency amount, original amount, original currency, `conversionSource` (`EXCHANGE` or `CUSTOM`), and server-used conversion rate
- **AND** the export does not include a separate conversion as-of column

#### Scenario: Export same-currency expense
- **WHEN** an export includes an expense with null `conversionSource`
- **THEN** the export includes the Ledger-currency amount without requiring conversion metadata

#### Scenario: Export does not invent exchange provenance
- **WHEN** an export includes an expense with `conversionSource` `CUSTOM`
- **THEN** the export identifies the rate as custom and does not present it as a provider exchange rate

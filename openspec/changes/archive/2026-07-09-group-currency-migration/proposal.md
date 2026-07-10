## Why

Today a group’s currency cannot be changed after it has expenses. Users must recreate a group even when the original currency was a mistake. We need a safe, guided migration that reprices every expense into a new ledger currency while preserving each expense’s entered amount and split data.

## What Changes

- Add an ADMIN-only currency-migration flow for groups with expenses. Groups without expenses keep the ordinary editable currency selector.
- The migration accepts only application-supported ISO currencies: the old ledger currency, destination, and every expense’s effective original currency must be supported. A preflight query blocks migration and identifies unsupported currencies and affected expenses before the user can continue.
- Migration always converts **directly** from each expense’s effective original currency to the destination. It never preserves, composes, or otherwise reuses a pre-existing custom conversion rate.
- The flow discovers one distinct `original currency → destination currency` pair per effective original currency. For every pair, the user selects the same resolution policy already offered by import: per-expense-date provider rates, one provider rate fixed at a selected date, or a manually entered fixed custom rate.
- Show a client-side preview of the selected rate resolution. The review step summarizes the applied rates by direct pair and date, never individual expense conversions. It is informational only: the mutation resolves all provider-backed rates again on the server. Fixed custom rates remain user input and are validated server-side.
- Extract the import wizard’s currency-pair policy controls, rate-preview state/logic, and applied-rate summary into shared, feature-neutral components. Import and migration retain their own source/destination and commit logic.
- A migrated foreign-currency expense keeps `originalAmount` and `originalCurrency`, but receives a new direct rate and converted ledger amount. A previously same-currency expense uses its old ledger amount/currency as its new original amount/currency.
- When prior custom currency rates exist, the confirmation warns that they will be discarded and totals may change.
- The atomic migration updates the ledger currency and expense-level conversion fields only; shares and item rows are untouched. It records one activity-log event.

## Capabilities

### New Capabilities

- `group-currency-migration`: Guided ISO-only group ledger currency migration with per-pair rate-resolution choices, preview, server-authoritative provider rates, and direct repricing.

### Modified Capabilities

- `groups`: Existing groups with expenses change currency only through migration; groups without expenses retain direct settings editing.
- `currency-conversion-wizard`: Shared pair-resolution controls and preview behavior used by both import and currency migration.

## Impact

- **Web**: A nested migration route and a small wrapper around shared conversion-wizard components; group settings use a vertical details layout with a read-only currency identity and show either an inline simple change action or a migration action. The import wizard is refactored to consume the shared components without changing its behavior.
- **API**: A preflight query and atomic migration mutation. Provider-backed rates are resolved server-side at commit time.
- **Domain**: ISO eligibility, effective-original-currency classification, direct-pair grouping, and direct conversion math. No multi-leg rate calculations.
- **DB**: No schema migration. Existing `ConversionSource` values remain; direct provider results store `EXCHANGE`, and fixed/custom results store `CUSTOM`.
- **Translations**: Add migration and shared conversion UI strings through the i18n CLI; remove the obsolete edit-mode currency-lock helper copy.
- **Tests**: Domain, API integration, and web tests cover eligibility blocks, pair choices, warnings, previews, server authority, atomicity, and shared-component parity with import.

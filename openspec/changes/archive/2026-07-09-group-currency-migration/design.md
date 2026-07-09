## Context

`Ledger.currency`/`currencyCode` define the group’s ledger currency. Expense `amount` is in that currency; cross-currency expenses additionally preserve `originalAmount`, `originalCurrency`, `conversionRate`, and `conversionSource`. Rate semantics are `1 unit original = rate units ledger`.

The import flow already groups source currencies into destination pairs and lets users choose per-expense-date exchange rates, a fixed provider rate for a selected date, or a fixed custom rate. Its UI and rate-preview behavior are the right shared abstraction for this feature.

## Goals / Non-Goals

**Goals:**

- Let an ADMIN migrate an active group with expenses to a supported ISO currency.
- Let users choose a rate-resolution policy once for every direct source→destination pair and preview the resolved rates before committing.
- Make provider-backed rates authoritative on the server while keeping client previews responsive.
- Preserve original expense inputs and split/item rows; rewrite only ledger conversion fields atomically.
- Reuse generic conversion-wizard primitives between import and migration.

**Non-Goals:**

- No non-ISO/custom source, old-ledger, or destination currencies in migration.
- No multi-leg conversion, rate chaining, or reuse of existing conversion rates.
- No per-expense rate choices, undo, snapshots, or schema changes.
- No behavioral change to import beyond using extracted shared UI/state/preview primitives.

## Decisions

### 1. Eligibility is ISO-only and fails before configuration

The preflight query loads the ledger and expenses, derives every expense’s effective original currency, and validates it against the application/provider-supported ISO list. The old ledger currency and selected destination must meet the same requirement. If anything is unsupported, the response is ineligible and includes the codes plus affected expense identifiers/counts; the web flow shows an error and cannot enter pair configuration.

This deliberately keeps arbitrary currencies outside the feature. A user must correct or export such data before migration rather than making the initial feature responsible for it.

### 2. Every conversion is direct

For an expense already converted from EUR to USD, migration to GBP uses EUR→GBP. Its former EUR→USD rate is not an input to calculation. For a same-currency USD expense migrating to GBP, its effective original currency is USD.

The resulting direct rate is stored as `EXCHANGE` for provider-backed policies and `CUSTOM` for either fixed policy. A preflight warning counts expenses with `conversionSource = CUSTOM`; confirmation explains that their historical custom currency rates are discarded and totals may change.

### 3. Shared conversion-wizard primitives, feature-owned orchestration

Extract a feature-neutral module used by both flows:

- pair definitions and choice schemas (`perDate`, `fixedProvider`, `fixedCustom`);
- radio-group pair policy cards and rate-policy controls;
- client preview-rate loading/derivation;
- applied-rate summary rendering and validation.

Import supplies parsed source pairs and consumes resolved choices to build an import batch. Migration supplies effective-original pairs and consumes choices to request a rewrite. Route layout, navigation, destination selection, and final mutation remain feature-specific; this avoids forcing two different workflows into one monolithic wizard.

### 4. Preview is client-side; provider rates are resolved again on the server

The browser fetches rates for display only. At commit time, the mutation receives pair policies and fixed numeric rates. It re-fetches all provider-backed rates for the needed expense dates or selected fixed dates. It never accepts client values as provider rates. A manually entered fixed custom rate is allowed as user input and validated as positive and finite.

If a provider rate changes between preview and commit, the committed amount follows the server result; the UI explains that the final migration uses server-resolved rates. The review shows rates grouped by pair and date, not simulated per-expense conversions. Provider failures abort before writes, and the database transaction is not started until all rates and rewrites are computed.

### 5. Rewrite expense-level conversion fields only

For previously same-currency expenses, set `originalAmount = old amount` and `originalCurrency = old ledger ISO code`, then calculate a direct converted `amount`. For already-cross-currency expenses, retain `originalAmount`/`originalCurrency` and replace only the direct `conversionRate`, `conversionSource`, and `amount`.

Do not modify `ExpensePaidBy`, `ExpensePaidFor`, `ExpenseItem`, or `ExpenseItemPaidFor`. BY_AMOUNT values remain expressed in original-currency minor units and the read-side calculation reapplies the new rate; unitless split modes remain valid.

### 6. Settings use the simplest safe entry point

Group information is a vertical details layout. It displays the current currency as a compact identity (flag, localized full name, ISO code, and a non-duplicated symbol), not as a disabled input. A group with no expenses shows this read-only identity until the admin chooses the inline simple change action, which swaps it for `CurrencySelector` and the normal Save action. Once expenses exist, settings instead show the Migrate currency action. `groups.update` continues rejecting a direct currency change where expenses exist.

### 7. Navigation and cache freshness are explicit

The edit route is a layout with an outlet so `/groups/$groupId/edit/currency-migration` renders its own page instead of the settings tab. The destination selector initially shows the current ledger currency and requires a different supported code before preflight begins. A no-pair migration still requires acknowledgement but omits both the applied-rates panel and the provider re-resolution note.

After success, the client resets the group, group-details, expense-list, expense-detail, balance, stats, activity, account-group, and balance-preview query families before navigating to settings. Resetting, rather than only invalidating partial keys, prevents a cached token-specific or expense-ID-specific query from rendering pre-migration currency or amounts.

## Flow

```text
settings (expenses exist)
  → migration route (nested edit child)
  → destination selection (current currency preselected; choose a different code)
  → preflight eligibility
  → direct-pair rate policies + client rate preview
  → review applied rates by pair/date (including discarded-custom-currency-rate warning)
  → server resolves rates again → one atomic rewrite → reset relevant caches → settings
```

## Risks / Trade-offs

- **Historical totals can change**: direct repricing intentionally discards prior custom conversion choices. The preview and explicit acknowledgement make this visible.
- **Provider drift/outage**: preview values can differ from commit values and provider failures block the commit. This is preferable to trusting the browser for market rates.
- **Large ledgers**: one transaction updates all expenses. Rate tuples are deduplicated and fetched in batches; no evidence currently justifies background jobs.
- **Shared extraction regression**: import behavior is protected by shared-component tests plus its existing import tests.

## Migration Plan

No database migration or feature flag is required. API and web ship together. Rolling back code does not reverse a completed migration; confirmation labels it irreversible.

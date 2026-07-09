## 1. Domain: direct-pair migration model

- [x] 1.1 Add migration schemas/types for effective-original expense rows, ISO eligibility results, direct currency pairs, and pair policies (`perDate`, `fixedProvider`, `fixedCustom`). Keep the model limited to one direct rate per pair.
- [x] 1.2 Implement effective-original classification: same-currency rows use the old ledger ISO currency and amount; converted rows retain original currency/amount.
- [x] 1.3 Implement ISO eligibility and direct-pair grouping, returning unsupported codes and affected expense counts/IDs before pair choices can be configured.
- [x] 1.4 Implement direct rewritten-field calculation for each policy. Provider policies map to `EXCHANGE`; fixed provider/custom policies map to `CUSTOM`.
- [x] 1.5 Add domain tests for same-currency and already-converted expenses, each policy, ISO blocks, and the invariant that BY_AMOUNT shares/items are outside rewritten fields.

## 2. Shared currency-conversion wizard primitives

- [x] 2.1 Extract the import pair-card UI into a feature-neutral shared component with direct-pair inputs and all three policies: per expense date, fixed provider rate by selected date, and fixed custom rate.
- [x] 2.2 Extract shared pair-choice state, validation, rate-preview requests/derivation, and applied-rate summary rendering. Use `RadioGroup`/`RadioGroupItem` policy controls and keep import-specific batch construction and migration-specific mutation orchestration outside this module.
- [x] 2.3 Refactor the import wizard to use the shared primitives with no behavior change: keep only the wizard-shell Continue action and show applied rates by pair/date on confirmation. Add focused tests covering each policy and summary display.

## 3. API: preflight and atomic mutation

- [x] 3.1 Add `groups.migrateCurrencyPreview`: ADMIN-only; reject archived groups; load all migration fields; validate old ledger/effective-original ISO support; return eligibility, unsupported-currency detail, direct pairs, affected counts, and the count of rows whose existing source is `CUSTOM`.
- [x] 3.2 Add `migrateGroupCurrency`: validate destination ISO support/difference and pair choices; re-load current data and repeat eligibility/authorization checks to prevent stale previews.
- [x] 3.3 Resolve provider-backed rates server-side at mutation time, batching unique expense-date and fixed-date tuples. Accept only user-entered custom fixed rates from the client; validate all fixed rates are positive finite values.
- [x] 3.4 Compute all rewritten fields before entering a single Prisma transaction; transactionally update ledger currency, every expense’s five conversion columns, and one currency-migrated activity event. Leave all shares/items unchanged.
- [x] 3.5 Add `groups.migrateCurrency` procedure and registrations; map provider failures to `BAD_GATEWAY` and invalid choices/unsupported data to `BAD_REQUEST`.
- [x] 3.6 Add API integration tests for: eligibility rejection of non-ISO old/destination/original currencies; all direct policies; existing custom-rate warning/direct repricing; server provider-rate authority; atomic rollback; untouched shares/items; archived/non-admin rejection; and activity logging.

## 4. Web: settings and migration flow

- [x] 4.1 Render Group information as vertical details. For groups without expenses, show a read-only currency identity with an inline simple change action that reveals `CurrencySelector`; for groups with expenses, show the read-only identity and Migrate currency action. Remove obsolete lock-warning copy and avoid duplicate ISO-code/symbol labels.
- [x] 4.2 Add the typed nested migration route and feature-owned page shell (authorization, current-currency destination preselection, preflight loading, confirmation, success redirect) so direct migration URLs render the wizard.
- [x] 4.3 Feed migration pairs into the shared conversion-wizard primitives. Render ineligible unsupported-currency errors before the policy step.
- [x] 4.4 Render client-side rate-policy previews and a confirmation summary with Applied exchange rates by pair/date. Omit the rate summary and provider note when no conversion is needed; warn that existing custom currency rates will be discarded and require irreversible-action acknowledgement.
- [x] 4.5 Submit only destination, pair policies, and fixed custom rates. Reset group, settings, expense, balance, stats, activity, and account query families before redirecting to settings so no pre-migration currency or amount is rendered from cache.

## 5. Translations and verification

- [x] 5.1 Add/prune all strings using the `bun i18n` CLI and translate non-English locales with the `translate-strings` skill; run `bun i18n check`.
- [x] 5.2 Run `bun check-types`, `bun check-formatting`, and `bun run test`.
- [x] 5.3 Run `bun test:integration` when its database/server prerequisites are already available; do not start services.
- [x] 5.4 Manually verify, when permitted, USD same-currency and EUR previously-custom-rate expenses migrating to GBP using each policy, including preview/commit server-rate behavior.

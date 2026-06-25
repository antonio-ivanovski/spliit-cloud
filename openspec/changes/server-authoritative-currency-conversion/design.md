## Context

Spliit currently fetches exchange rates directly from the browser and submits converted amounts to the API. The API stores `amount`, `originalAmount`, `originalCurrency`, and `conversionRate`, but it does not verify that `amount` matches the original value and rate. Balance calculations already assume that `Expense.amount` and `ExpensePaidFor.shares` are stored in Ledger base-currency minor units.

This change keeps that accounting invariant but moves the conversion authority to the server. The client may still show an illustrative preview, but persisted ledger-currency values are computed by the API from original/input currency values and a server-resolved rate.

## Goals / Non-Goals

**Goals:**

- Make the API authoritative for exchange-rate lookup and conversion math.
- Preserve the user-entered original amount, original currency, rate used, and provider rate date/as-of metadata.
- Keep all balances, reimbursements, settlements, summaries, and statistics based on Ledger base-currency minor units.
- Allow `BY_AMOUNT` splits to be entered in the original/input currency while storing normalized Ledger-currency shares.
- Prevent accidental accounting corruption by blocking Ledger/group base-currency changes after expenses exist.
- Avoid spamming the external currency-rate provider by adding a temporary in-memory cache.
- Support converted reimbursement expenses through the same server-authoritative conversion path as normal expenses.
- Remove custom currency selection so groups and expenses use only supported ISO currency codes.

**Non-Goals:**

- Implement full ledger rebasing from one base currency to another.
- Add Redis or another distributed cache dependency.
- Become a complete FX provider or support currencies unavailable from the selected provider.
- Change percentage, shares, or evenly split semantics beyond conversion normalization for amount-based splits.
- Recalculate historical expense amounts automatically after they are saved.
- Export per-participant original split-share metadata in the first implementation; keep that metadata internal for edit-form replay unless a later export requirement needs it.

## Decisions

### Server computes persisted conversion values

The client submits original/input values for converted expenses and treats preview conversion as illustrative only. The API resolves the rate, computes `Expense.amount`, normalizes amount-based `ExpensePaidFor.shares`, and persists the server-used rate metadata.

Alternative considered: continue accepting converted amount from the client and only validate it server-side. That reduces API churn but still makes client rounding and stale rates part of the persistence path. Server computation gives a single source of truth.

### Submitted amount is always input-currency amount

The expense API keeps a simple input model: `amount` is always the amount the user typed, and the selected expense currency tells the server how to interpret it. If selected currency equals the Ledger base currency, the server stores `amount` directly as Ledger-currency minor units and does not set conversion metadata. If selected currency differs, the server treats `amount` as the original/input amount, fetches the rate using the existing `expenseDate`, and stores the converted Ledger-currency amount in `Expense.amount` plus original/conversion metadata.

Example: in a USD Ledger, submitting `amount = 10.00` with currency `USD` stores 10.00 USD and no conversion metadata. Submitting `amount = 10.00` with currency `EUR` stores original 10.00 EUR, resolves EUR->USD for the expense date, and persists the converted USD `Expense.amount`.

When editing an expense, changing the selected expense currency is allowed. The form keeps the entered numeric amount unchanged by default and reinterprets it in the new selected currency; the user can then edit the amount if needed. Example: an existing `10.00 EUR` expense in a USD Ledger changed to `GBP` becomes an input of `10.00 GBP` by default, and the server recomputes the persisted USD amount using GBP->USD for the existing expense date.

### Expense date drives historical rate lookup

Rates are requested for the expense date, not the current timestamp. If the provider returns the closest available date, the API stores that provider-returned date as conversion as-of metadata.

Alternative considered: use the rate at creation time. That is simpler to explain technically but less aligned with expense accounting expectations and makes old expense entry depend on when the user records it.

For future dates, keep the behavior simple: accept the provider's latest available fallback rate, persist the returned as-of date, and show that as-of date in preview/detail metadata when available. Do not block future-dated converted expenses solely because the provider cannot return a future rate.

If the provider request fails and the exact `(inputCurrency, ledgerCurrency, expenseDate)` rate is not cached, the server may use the latest cached rate for that currency pair if its as-of date is within 7 days of the requested expense date. No separate cache-source metadata is persisted; the normal `conversionRate` and `conversionAsOf` fields explain the rate used. If no sane cached fallback exists, converted expense saves are blocked.

### In-memory cache first

The API keeps an in-memory cache keyed by `(baseCurrency, targetCurrency, requestedDate)` or equivalent normalized pair/date. Cache values include the rate, requested date, provider-returned as-of date, and fetched timestamp.

The cache also keeps enough pair-level indexing to find the latest cached rate for a pair when the provider is unavailable and the exact date is missing. This fallback is bounded by the 7-day sanity limit.

Alternative considered: DB-backed cache. That would survive restarts and make historical lookups deterministic even after process restarts, but it is more schema and operational scope. This proposal keeps DB persistence on the actual expense and uses in-memory cache only to reduce provider traffic.

### Persist normalized values plus original metadata

The existing `Expense.amount` remains the value used for accounting. `originalAmount`, `originalCurrency`, and `conversionRate` remain audit/display metadata, with additional metadata for requested/as-of rate dates if needed. For `BY_AMOUNT` splits, persisted shares remain Ledger base-currency minor units.

The edit form needs the original values the user typed. If amount-based split rows need to reload exactly in original currency, add nullable original-share metadata to paid-for rows. Without that, the edit form would need to reverse-convert from stored Ledger-currency shares, which can introduce rounding drift.

Example: a USD Ledger has a 100 EUR expense at EUR->USD 1.0832, split by amount as Alice 33.33 EUR and Bob 66.67 EUR. The persisted Ledger-currency shares might be Alice 36.10 USD and Bob 72.22 USD after rounding. If the edit form later tries to reconstruct EUR inputs from USD shares, it may show 33.33 EUR and 66.66 EUR or similar drift. Persisting `originalShare` on paid-for rows lets the edit form reload exactly Alice 33.33 EUR and Bob 66.67 EUR.

Decision: persist nullable original paid-for share metadata for `BY_AMOUNT` splits on converted expenses. For same-currency expenses and non-amount split modes, the existing persisted share semantics remain sufficient.

To keep the export surface small, this original-share metadata is internal for edit-form replay in the initial implementation. Exports include expense-level original amount/currency/rate metadata, but not per-participant original share columns unless a later export-focused change explicitly adds them.

When editing an expense and changing its selected currency, amount-based split inputs keep their numeric values by default and are reinterpreted in the new selected currency, matching the total amount behavior. The form can still rebalance or let the user edit shares before saving. Non-amount split modes do not need per-participant currency reinterpretation because they divide the server-converted total by percentage, equal participation, or relative shares.

Split mode handling by currency:

- `EVENLY`: the input amount is converted to Ledger currency server-side, then split evenly using existing rounding behavior.
- `BY_PERCENTAGE`: the input amount is converted to Ledger currency server-side, then percentages apply to the converted Ledger-currency total.
- `BY_SHARES`: the input amount is converted to Ledger currency server-side, then relative shares apply to the converted Ledger-currency total.
- `BY_AMOUNT`: the total amount and paid-for share amounts are entered in the selected expense currency, validated in that currency, preserved for edit replay, and normalized to Ledger-currency shares server-side.

Input amounts and amount-based shares are parsed using the selected/input currency decimal precision. Persisted `Expense.amount` and amount-based paid-for shares are stored using the Ledger currency decimal precision. Example: a JPY expense in a USD Ledger accepts whole-yen input, converts with JPY->USD, then stores the USD result in cents.

### Only supported ISO currencies are selectable

Custom currencies are removed from new and updated group/expense flows. A Ledger base currency and an expense selected currency must be one of the supported ISO currency codes. This avoids conversion ambiguity and removes custom-currency branches from the multi-currency model.

Existing groups with custom/empty currency values are not rebased by this change. They can remain readable, but updating their currency requires selecting a supported currency and still obeys the rule that base currency cannot change once expenses exist.

### Converted amount-split rounding uses largest remainder

Converted totals and amount-based shares are converted into integer minor units. The server first converts the expense total and each original-currency amount share using precise decimal arithmetic. It floors converted shares to minor units, then distributes remaining minor units to the shares with the largest fractional remainders, using submitted paid-for order as a deterministic tie-breaker.

Example: a 10.00 EUR expense converts to 10.01 USD, split equally as three amount shares of 3.33 EUR, 3.33 EUR, and 3.34 EUR. Independent rounding can produce shares that sum to 10.00 USD or 10.02 USD. Largest-remainder normalization guarantees the persisted shares sum exactly to the persisted 10.01 USD total while minimizing rounding distortion.

Recommendation: use largest remainder rather than assigning all remainder to the last participant. It is deterministic, fairer for uneven splits, and easier to test because the fractional remainders explain which participant receives each extra minor unit.

### Preview rate API uses tRPC

The preview rate API is exposed as a tRPC procedure to match the current application API style. No separate public Hono route is introduced for rate preview in this change.

### Block base-currency changes after expenses exist

Changing the Ledger base currency after expenses exist would make persisted amounts semantically wrong unless every existing expense and paid-for share is rebased. This proposal blocks normal group currency updates after any expenses exist.

Alternative considered: explicit rebase operation. That is valid future work, but it needs a dedicated migration flow, historical rate handling, confirmation UI, and rounding policy.

### UI separates audit display from accounting display

Expense creation/edit/detail surfaces can show both original and converted amounts. Balance, reimbursement, settlement, summary, and statistics surfaces show Ledger base-currency values only.

Converted reimbursements use the same rules as other converted expenses: the user-entered amount/currency are converted server-side into Ledger base-currency values, and accounting surfaces use only the persisted Ledger-currency amount.

## Risks / Trade-offs

- Provider outage blocks new converted expense and converted reimbursement saves -> show a clear validation error and allow same-currency expenses to continue.
- In-memory cache is lost on restart -> acceptable because the saved expense stores the rate used; subsequent new lookups can refetch.
- Provider returns unsupported pairs -> validate against supported currencies and return a user-facing unsupported conversion error.
- Cached fallback rate is too stale -> block converted save rather than silently using a rate older than 7 days from the requested expense date.
- Amount-split rounding can leave one minor unit unallocated -> define deterministic remainder assignment during normalization.
- Existing production data is expected to contain only Ledger-currency expenses for this feature scope -> preserve existing rows as-is and do not run any recomputation migration.
- Concurrent group currency update versus expense creation could race -> enforce the currency-change block transactionally or with a server-side existence check immediately before update.

## Migration Plan

- Add the server-side rate lookup/cache service and tRPC preview procedure without changing persistence behavior.
- Update expense create/update validation so converted expenses are normalized server-side.
- Add nullable conversion metadata columns if needed, and nullable original-share columns for faithful edit forms on converted `BY_AMOUNT` splits.
- Update the web form to call the server for preview, remove custom currency choices, and submit input amount/currency values.
- Add the base-currency change block in the group update path.
- Preserve all existing expense rows without recomputation; current data is expected to contain no expenses in a different currency from the group base currency, and existing `amount` and shares remain Ledger-currency values.

## Open Questions

- None for the initial implementation scope.

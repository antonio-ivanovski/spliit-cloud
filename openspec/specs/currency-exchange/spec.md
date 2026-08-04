## Purpose

Defines the supported currency catalog (fiat ISO codes and crypto assets), how expense and group monetary inputs respect per-currency decimal precision, and how exchange rates are resolved, cached, and attributed across Frankfurter (fiat) and Coinbase (crypto) providers — including bridged pairs, scale aliases, and the public rate API contract.

## Requirements

### Requirement: Supported currency catalog
The system SHALL maintain a canonical currency list in `packages/domain/src/currencies.json` consumed by the domain package, API validation, and web currency selectors. Each entry SHALL include `code`, `symbol`, `rounding`, `decimal_digits`, and optional `aliases` for import resolution. Fiat ISO codes SHALL use three letters. Crypto assets SHALL be marked with `crypto: true` and MAY use three- or four-letter tickers (e.g. `DOGE`).

#### Scenario: Crypto assets in the catalog
- **WHEN** the catalog is loaded
- **THEN** it includes supported crypto assets such as `BTC`, `ETH`, `DOGE`, `LTC`, `SOL`, `XRP`, and the satoshi alias `SAT`

#### Scenario: Unknown code rejected
- **WHEN** an API request references a currency code not in the catalog
- **THEN** the system rejects the request as an unsupported currency

### Requirement: Currency scale aliases
The catalog MAY define scale aliases where one unit of a code equals `aliasScale` units of a parent `aliasOf` code (e.g. `1 SAT = 1e-8 BTC`). Rate lookups SHALL expand aliases to the parent code before calling external providers; resolved rates SHALL be scaled back to the requested alias code. Alias codes SHALL remain selectable in the UI and valid in API payloads.

#### Scenario: SAT expense priced in USD
- **WHEN** a rate is requested for `SAT` → `USD`
- **THEN** the resolver quotes `BTC` → `USD` via the crypto provider and multiplies by the SAT scale factor

#### Scenario: Same alias parent
- **WHEN** a rate is requested between an alias and its parent (e.g. `SAT` → `BTC`)
- **THEN** the resolver returns the scale ratio without calling an external provider

### Requirement: Currency code validation length
API and form schemas for `currencyCode`, `originalCurrency`, and import currency fields SHALL accept codes of length 3–4 characters to cover four-letter crypto tickers, or an empty string where custom group currencies are allowed.

#### Scenario: Four-letter crypto ticker on expense
- **WHEN** a user creates an expense with `originalCurrency: "DOGE"`
- **THEN** validation accepts the code and persistence stores `DOGE`

### Requirement: Monetary amount storage limits
Expense and item amounts SHALL be stored as signed integer minor units of the expense currency (not decimal majors). API validation SHALL cap amounts at the signed 32-bit integer maximum (`2_147_483_647`) so high-decimal crypto quantities remain representable within database `Int` columns.

#### Scenario: Large satoshi amount
- **WHEN** a user enters an expense amount in a high-decimal crypto currency
- **THEN** the stored minor units MAY exceed legacy fiat cent ceilings while remaining within the Int32 bound

### Requirement: Per-currency decimal input precision
Amount inputs for expenses, expense items, budgets, and the standalone currency converter SHALL sanitize user typing to the selected currency's `decimal_digits` from the catalog. Placeholders SHALL reflect the same precision, capped at four fractional digits for display (e.g. `0` for zero-decimal `SAT`, `0.00` for USD, up to `0.0000` for eight-decimal BTC). Conversion-rate custom inputs SHALL NOT apply currency decimal caps.

#### Scenario: USD amount rejects excess decimals
- **WHEN** a user types `0.00001` into a USD amount field
- **THEN** the input is truncated to two fractional digits (`0.00`)

#### Scenario: SAT placeholder shows zero decimals
- **WHEN** the user selects `SAT` as the expense currency
- **THEN** the amount placeholder shows `0`, not `0.00`

### Requirement: Default intermediary currencies
When no direct exchange rate exists, the resolver SHALL attempt bridging through an ordered intermediary list. The default list SHALL be `EUR` then `USD`, defined in code (`DEFAULT_INTERMEDIARY_CURRENCIES`) and NOT duplicated per row in `currencies.json`. Individual catalog entries MAY override `intermediaries` when needed.

#### Scenario: Crypto to exotic fiat bridges through EUR
- **WHEN** Coinbase has no direct quote for a crypto→fiat pair but quotes crypto→EUR and Frankfurter quotes EUR→fiat
- **THEN** the resolved rate composes through `EUR` and records `via: ['EUR']`

#### Scenario: Crypto to crypto bridges when direct missing
- **WHEN** no direct or inverted Coinbase quote exists for two crypto codes
- **THEN** the resolver attempts bridging through the default intermediary list using per-leg provider routing

### Requirement: Metadata-driven exchange provider routing
Rate resolution SHALL choose the upstream provider from catalog metadata, not by trying providers until one succeeds. Fiat↔fiat pairs SHALL use Frankfurter only. Any pair involving at least one `crypto: true` code SHALL use Coinbase for the crypto-involving leg(s). Frankfurter SHALL NOT receive crypto codes; Coinbase SHALL be attempted for crypto legs before bridging.

#### Scenario: EUR to USD
- **WHEN** a rate is requested for `EUR` → `USD`
- **THEN** Frankfurter is called and Coinbase is not used

#### Scenario: BTC to USD
- **WHEN** a rate is requested for `BTC` → `USD`
- **THEN** Coinbase is called (direct orientation, then inverted if needed)

### Requirement: Coinbase spot orientation and inversion
For crypto-involving pairs, the crypto provider SHALL first request a direct spot quote for `base`→`target`. When that returns no quote, it SHALL request `target`→`base` and invert the rate. A null result after both attempts SHALL allow intermediary bridging rather than failing immediately.

#### Scenario: Inverted crypto pair
- **WHEN** Coinbase quotes `BTC`→`USD` but not `USD`→`BTC`
- **THEN** a `USD`→`BTC` request succeeds by inverting the `BTC`→`USD` quote

### Requirement: Exchange rate API response contract
The public currency rate endpoints (`currency.getRate` query and `currency.rates` mutation / HTTP bulk route) SHALL return, for each successful lookup: `rate`, `requestedDate`, `asOfDate`, `base`, `target`, `sources` (ordered array of `{ provider, base, target }` legs with `provider` ∈ `frankfurter` | `coinbase`), and optional `via` (bridge currency codes). Same-currency and pure alias-scale results MAY return an empty `sources` array. Per-item failures in batch requests SHALL be returned alongside successes.

#### Scenario: Direct fiat rate metadata
- **WHEN** `EUR`→`USD` resolves directly via Frankfurter
- **THEN** `sources` is `[{ provider: 'frankfurter', base: 'EUR', target: 'USD' }]` and `via` is absent

#### Scenario: Bridged crypto-fiat metadata
- **WHEN** `DOGE`→`MKD` resolves via `EUR`
- **THEN** `via` is `['EUR']` and `sources` lists the Coinbase leg (`DOGE`→`EUR`) and Frankfurter leg (`EUR`→`MKD`) in order

### Requirement: Exchange rate caching
The API SHALL cache resolved rates in a simple in-process TTL cache keyed by `(date, base, target)` without embedding provider logic in the cache module. Frankfurter historical dates SHALL use a 24-hour TTL. Crypto pairs whose lookup date is today or in the future SHALL use a shorter TTL (15 minutes) for intraday freshness; past crypto dates keep the 24-hour TTL.

#### Scenario: Repeated form preview hits cache
- **WHEN** the same `(date, base, target)` is requested twice within the TTL
- **THEN** the second request returns the cached rate without calling the external provider

### Requirement: Exchange rate date selection
For `conversionSource` `EXCHANGE`, rate lookup SHALL use the expense date for past and current calendar dates. Future expense dates SHALL request today's rate (UTC calendar day). The UI SHALL disclose when today's rate is used for a future expense date.

#### Scenario: Future expense date
- **WHEN** an exchange conversion preview runs for an expense dated after today
- **THEN** the lookup date is today and the UI notes that today's rate applies

#### Scenario: Weekend or holiday as-of fallback
- **WHEN** the provider returns an `asOfDate` earlier than the requested date for a past weekday
- **THEN** the client MAY surface a stale-rate notice while still using the returned rate

### Requirement: Provider attribution in the UI
When displaying an automatic exchange rate (not custom), the web app SHALL show which provider supplied the quote using localized copy with links to the provider APIs: Frankfurter (`https://frankfurter.dev/`) and Coinbase spot documentation. When `via` is present, the UI SHALL show the intermediary currency and per-leg providers (e.g. bridged through EUR with Coinbase then Frankfurter).

#### Scenario: Fiat expense form attribution
- **WHEN** an expense uses EXCHANGE conversion from USD to EUR
- **THEN** the form shows a Frankfurter link as the rate source

#### Scenario: Bridged crypto attribution
- **WHEN** a BTC→MKD rate was bridged through EUR
- **THEN** the UI shows the intermediary and linked providers for each leg

### Requirement: Standalone currency converter
The account-level currency converter SHALL use the same rate API and provider attribution as the expense form. It SHALL respect per-currency `decimal_digits` on the amount input and MAY deep-link into expense creation with minor-unit amount and `originalCurrency` search params.

#### Scenario: Converter rate line
- **WHEN** a user converts between two different supported currencies
- **THEN** the converter shows the live rate, optional `via` bridging, and provider attribution with API links

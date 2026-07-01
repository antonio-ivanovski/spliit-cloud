# splitwise-import Specification

## Purpose

Defines how users import a group from a Splitwise CSV export into Spliit Cloud. Covers the CSV parser, category mapping rules, reimbursement detection, multi-currency handling, and the source-step UI that wires the Splitwise tab to the existing import wizard without modifying the wizard, the tRPC commit path, or the database.

## Requirements
### Requirement: Splitwise CSV source format

The system SHALL accept a Splitwise CSV export through the existing import wizard's source step. The expected header is `Date,Description,Category,Cost,Currency,<participant>,...` with one column per Splitwise participant and one data row per expense. The Splitwise parser distinguishes its format from a Spliit CSV by header slot position: Splitwise has `Cost` in slot 3 and `Currency` in slot 4, while Spliit has `Currency` in slot 3 and `Cost` in slot 4.

The parser is dispatched by the active provider tab and the file extension (the Splitwise tab routes `.csv` files to `tryParseSplitwiseCsv`); it is NOT dispatched by auto-detecting the header shape from a single file. Each parser still validates its own header strictly and returns `{ ok: false, error: "CSV header is not a Splitwise export" }` when the header does not match.

#### Scenario: Valid Splitwise CSV is parsed

- **WHEN** the user drops a CSV whose header matches `Date,Description,Category,Cost,Currency,...` on the Splitwise tab
- **THEN** the parser returns a `NormalizedSource` with one `participant` per column from slot 5 onward and one `expense` per non-empty data row

#### Scenario: Header preamble lines are skipped

- **WHEN** the CSV starts with one or more non-header lines before the actual header row (e.g. an explanatory note from Splitwise)
- **THEN** the parser locates the header row by scanning for the `Date,Description,Category,Cost,Currency` signature and parses rows that follow it

#### Scenario: A non-Splitwise CSV on the Splitwise tab is rejected

- **WHEN** the user drops a Spliit-shaped CSV (header `Date,Description,Category,Currency,Cost,...`) on the Splitwise tab
- **THEN** the parser returns `{ ok: false, error: "CSV header is not a Splitwise export" }` and the wizard does not advance

#### Scenario: A garbled CSV on the Splitwise tab is rejected

- **WHEN** the user drops a CSV whose header matches neither the Splitwise nor the Spliit signature
- **THEN** the parser returns a clear error and the wizard does not advance

### Requirement: Splitwise total-balance rows are skipped

The Splitwise CSV export appends one or more `Total balance` rows at the bottom for each currency. The parser SHALL skip any row whose `Description` equals `Total balance` (case-insensitive) so these footer rows never become imported expenses.

#### Scenario: Total balance row is dropped

- **WHEN** the CSV contains a row `2026-06-30,Total balance,,,MKD,0.00,0.00`
- **THEN** the parser does not include it in `expenses`

#### Scenario: Total balance with description variant

- **WHEN** the CSV contains a row whose `Description` is `total balance` or `TOTAL BALANCE`
- **THEN** the parser still drops it

### Requirement: Splitwise per-row currency is preserved

Each Splitwise CSV row carries its own `Currency` code. The parser SHALL set `amountCurrency` on each expense to the row's currency code, and SHALL leave `originalAmount`, `originalCurrency`, and `conversionRate` as `null` on every expense (no per-row prior conversion is recorded by the parser — cross-currency conversion runs at the confirm step against the destination ledger's base currency).

The source-level `currency` and `currencyCode` fields on `NormalizedSource` are set to the most common currency code across parsed rows, so a MKD-heavy export opens with MKD selected and an EUR-heavy export opens with EUR. The destination step lets the user override this default.

#### Scenario: MKD row preserves MKD as the row currency

- **WHEN** a row is `2026-01-14,Telekom 12.2025,General,1274.00,MKD,-1274.00,1274.00`
- **THEN** the imported expense has `amountCurrency: "MKD"`, `amount: 127400`, `originalAmount: null`, `originalCurrency: null`, and `conversionRate: null`

#### Scenario: EUR row preserves EUR as the row currency

- **WHEN** a row is `2024-04-23,Kola,General,1500.00,EUR,1500.00,-1500.00`
- **THEN** the imported expense has `amountCurrency: "EUR"`, `amount: 150000`, `originalAmount: null`, `originalCurrency: null`, and `conversionRate: null`

#### Scenario: Multi-currency CSV passes through unchanged in normalized form

- **WHEN** a single CSV mixes MKD, EUR, and USD rows
- **THEN** each expense carries its row's `amountCurrency` and no row's `amountCurrency` is forced to match any other row

#### Scenario: Most common currency becomes the source-level default

- **WHEN** a CSV has 40 MKD rows and 10 EUR rows
- **THEN** `NormalizedSource.currency` is `"MKD"` and `NormalizedSource.currencyCode` is `"MKD"` so the destination step opens with MKD pre-selected

### Requirement: Splitwise reimbursement detection

The parser SHALL mark a row as a reimbursement (`isReimbursement: true`) when either:

- `Category` equals `Payment` (case-insensitive), **or**
- `Description` matches the regex `/^.+ paid .+ /` (e.g. `"Jane D. paid John D. ден610.00 for "Settleup Ljubanishta""` — the trailing space in the regex matches the space between the second name and whatever follows)

Both signals appear in Splitwise exports. The `Payment` category is the canonical Splitwise signal; the description pattern catches older entries that pre-date the category rename.

#### Scenario: Payment category is a reimbursement

- **WHEN** a row has `Category: "Payment"` and any `Description`
- **THEN** the imported expense has `isReimbursement: true` and `category: "payment"`

#### Scenario: Description with "paid" pattern is a reimbursement

- **WHEN** a row has `Description: "Jane D. paid John D."` (no trailing text — the regex still matches because the space between `John` and `.` falls between `.+ ` and the `D.`)
- **THEN** the imported expense has `isReimbursement: true`

#### Scenario: Ordinary expense is not a reimbursement

- **WHEN** a row has `Category: "General"` and `Description: "Pazarenje"`
- **THEN** the imported expense has `isReimbursement: false`

### Requirement: Splitwise payer is the highest positive-value column

For each expense row, the participant column whose value is positive identifies the payer. Negative values indicate what that participant consumes; zero values are ignored. The payer is the participant with the strictly largest positive value across all columns; ties are broken by column order (first occurrence wins). If no column has a strictly positive value (all zero or all negative), the parser SHALL skip the row.

#### Scenario: Single positive column

- **WHEN** a row has `John Doe: -1274.00, Jane Doe: 1274.00`
- **THEN** `paidBySourceId` resolves to Jane Doe's source id (the only positive column)
- **AND** `paidFor` contains John Doe with `shares: 127400` (his absolute negative value) and the remaining-share floor of Jane Doe's positive entry

#### Scenario: Two positive columns, second is larger

- **WHEN** a row has `Antonio: 60.00, Dejan: -40.00` (Antonio is the larger positive value)
- **THEN** `paidBySourceId` resolves to Antonio's source id and `splitMode` is `BY_AMOUNT`

#### Scenario: Two positive columns, first is larger

- **WHEN** a row has `Antonio: -40.00, Dejan: 60.00`
- **THEN** `paidBySourceId` resolves to Dejan's source id

#### Scenario: Ties resolve to first occurrence

- **WHEN** a row has two positive-value columns with the exact same value
- **THEN** the parser takes the first positive column as `paidBySourceId`

#### Scenario: No positive value

- **WHEN** a row has only zero or negative values across all participant columns
- **THEN** the parser skips the row

### Requirement: Splitwise paidBy and paidFor reconstruction

For each parsed row the parser SHALL reconstruct `paidBy` and `paidFor` so the per-participant balances reconcile with the `Total balance` footer in the export, as follows:

- `paidFor` contains every **negative-value** participant with `shares = abs(raw) * 100` (their consumed share), followed by every **positive-value** participant with `shares = floor(remainingCost / positiveCount)` where `remainingCost = amount - sum(negativeShares)`. Any rounding drift on `paidFor` is absorbed by incrementing the positive entries in order until their sum equals `remainingCost` (each at most +1 cent).
- `paidBy` contains every **positive-value** participant with `shares = abs(raw) * 100 + consumedShare` where `consumedShare` is the `paidFor` share attributed to that participant. Any rounding drift on `paidBy` is absorbed by adding the drift to the largest `paidBy` entry.

#### Scenario: Even split between two participants

- **WHEN** a row has `Antonio: 180.00, Dejan: -180.00` with `Cost: 360.00`
- **THEN** `paidBySourceId` is Antonio, `paidBy: [{ Antonio, 36000 }]`, `paidFor: [{ Dejan, 18000 }, { Antonio, 18000 }]`, and `splitMode: 'EVENLY'`

#### Scenario: Uneven split produces BY_AMOUNT

- **WHEN** a row has `Antonio: 60.00, Dejan: -40.00` with `Cost: 100.00`
- **THEN** `paidBySourceId` is Antonio, `paidBy: [{ Antonio, 6667 }]`, `paidFor: [{ Dejan, 4000 }, { Antonio, 6000 }]`, and `splitMode: 'BY_AMOUNT'`

#### Scenario: paidFor shares sum exactly to amount

- **WHEN** the parsed row has any combination of positive and negative values
- **THEN** the sum of `paidFor` `shares` equals the row `amount` (cents), with at most 1 cent of drift absorbed by positive entries

### Requirement: Splitwise split mode is auto-detected

The parser SHALL set `splitMode` to `EVENLY` when every `paidFor` entry shares an equal (within 1 cent) amount AND there are at least two `paidFor` entries; otherwise it SHALL set `splitMode` to `BY_AMOUNT`.

#### Scenario: Two equal shares detected as EVENLY

- **WHEN** a row produces `paidFor: [{ A, 18000 }, { B, 18000 }]`
- **THEN** `splitMode` is `EVENLY`

#### Scenario: Single paidFor entry defaults to BY_AMOUNT

- **WHEN** a row produces only one `paidFor` entry (e.g. a reimbursement with one receiver)
- **THEN** `splitMode` is `BY_AMOUNT`

### Requirement: Splitwise category mapping

The parser SHALL map each Splitwise category string to a Spliit category id using a static table that covers Splitwise's two-level tree leaves: Entertainment (Games, Movies, Music, Sports), Food and drink (Dining out, Groceries, Liquor), Home (Electronics, Furniture, Household supplies, Maintenance, Mortgage, Pets, Rent, Services), Life (Childcare, Clothing, Education, Gifts, Insurance, Medical expenses, Taxes), Transportation (Bicycle, Bus/train, Car, Gas/fuel, Hotel, Parking, Plane, Taxi), Utilities (Cleaning, Electricity, Heat/gas, Trash, TV/Phone/Internet, Water), Uncategorized (General), and Payment. Custom strings containing ` - ` (e.g. `"Home - Other"`) SHALL be split on ` - `: when the right-hand side is `Other` the left-hand side wins (since Splitwise renders "Other" under a parent), otherwise the right-hand side is mapped first and the left-hand side is the fallback. Unknown categories fall back to `'general'` so an import never fails on a new Splitwise category.

#### Scenario: Known leaf category maps to its id

- **WHEN** a row has `Category: "Groceries"`
- **THEN** the imported expense has `category: "groceries"`

#### Scenario: Payment category maps to payment id

- **WHEN** a row has `Category: "Payment"`
- **THEN** the imported expense has `category: "payment"`

#### Scenario: Custom string with "Other" uses the parent

- **WHEN** a row has `Category: "Home - Other"`
- **THEN** the imported expense has `category: "home"` (the left-hand side wins when the right-hand side is "Other")

#### Scenario: Custom string with named subcategory uses the subcategory

- **WHEN** a row has `Category: "Home - Rent"` (left = Home, right = Rent, a known leaf)
- **THEN** the imported expense has `category: "rent"`

#### Scenario: Unknown category falls back to general

- **WHEN** a row has `Category: "Some Future Splitwise Category"`
- **THEN** the imported expense has `category: "general"`

### Requirement: Splitwise CSV is per-file, not multi-group

The parser SHALL treat each uploaded CSV as a single `NormalizedSource` with `provider: 'SPLITWISE'`, `sourceGroupId: 'splitwise-csv-import'`, `sourceUrl: null`, and `name: 'Imported from Splitwise'` (overridable by `guessGroupNameFromFilename`). The user is responsible for uploading one CSV per Splitwise group they want to import; multi-group splitting is not supported in this change.

#### Scenario: One CSV file produces one wizard run

- **WHEN** the user uploads a Splitwise CSV containing N expenses
- **THEN** the wizard commits those N expenses into one Spliit group named at the destination step

### Requirement: Splitwise source step UI

The source step SHALL show a Splitwise tab that activates a drag-and-drop file upload (the same `FileUploadCard` used by the Spliit tab). The file handler SHALL dispatch the parser based on the **active provider tab and the file extension** (the Splitwise tab routes `.csv` files to `tryParseSplitwiseCsv` and rejects everything else with `unsupportedFileType`). The dispatcher is `pickParser(provider, fileName)` driven by a per-provider `PROVIDERS` config table — it does NOT auto-detect by header shape and does NOT brute-force both parsers. The Splitwise tab's file picker restricts selection to `.csv` via the `accept=".csv,text/csv"` attribute. The tab SHALL NOT show a "coming soon" placeholder once this capability is implemented.

#### Scenario: Splitwise tab is active and accepts a Splitwise CSV

- **WHEN** the user selects the Splitwise tab and drops a Splitwise CSV
- **THEN** the parser returns a `NormalizedSource` and the wizard advances to the destination step

#### Scenario: Splitwise tab rejects a JSON file

- **WHEN** the user selects the Splitwise tab and drops a `.json` file
- **THEN** `pickParser` returns `{ format: null }`, the source step surfaces the `unsupportedFileType` error, and the wizard does not advance

#### Scenario: Splitwise tab rejects a Spliit-shaped CSV

- **WHEN** the user selects the Splitwise tab and drops a Spliit-shaped CSV
- **THEN** the Splitwise parser returns `{ ok: false, error: "CSV header is not a Splitwise export" }`, the source step surfaces that error, and the wizard does not advance

#### Scenario: Drag-and-drop is enabled on the Splitwise tab

- **WHEN** the user drags a `.csv` file over the Splitwise tab
- **THEN** the drop zone is highlighted and the file is accepted (no `provider !== 'spliit'` early return)

### Requirement: Splitwise tab shows distinct upload affordance

The Splitwise tab SHALL display provider-specific copy in its `FileUploadCard` (`dropFileSplitwise`, `dropFileDescriptionSplitwise`) so users see that the expected file is a Splitwise CSV, not a Spliit JSON/CSV. The Splitwise tab SHALL also show a Splitwise-specific receipt-warning copy (`receiptWarningTitleSplitwise`, `receiptWarningDescriptionSplitwise`).

#### Scenario: Splitwise tab shows Splitwise-specific drop copy

- **WHEN** the user selects the Splitwise tab
- **THEN** the drop card shows `dropFileSplitwise` and `dropFileDescriptionSplitwise` (e.g. "Drop a Splitwise CSV file, or click to select" / "CSV is the only format Splitwise exports...")

#### Scenario: Spliit tab shows Spliit-specific drop copy

- **WHEN** the user selects the Spliit tab
- **THEN** the drop card shows the existing `dropFile` / `dropFileDescription` keys (the Spliit JSON/CSV copy)

### Requirement: No server-side changes for Splitwise

The Splitwise parser SHALL output the existing `NormalizedSource` shape so the existing `groups.import` tRPC procedure, `importGroup()` business logic, `buildImportBatch()`, currency conversion, and wizard steps work without modification. No new tRPC procedures, no new Prisma models, no new database migrations.

#### Scenario: Splitwise import reuses the commit path

- **WHEN** the user confirms a Splitwise import at the confirm step
- **THEN** the web app calls the existing `groups.import` mutation with the same payload shape used for Spliit imports


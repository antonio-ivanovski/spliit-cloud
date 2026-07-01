# Migration from original Spliit

This guide covers importing a group from another expense-splitting app. The import system supports four sources: a `spliit.app` JSON export, a `spliit.app` CSV export, a `spliit.app` group URL that the server fetches on your behalf, and a Splitwise CSV export.

> Always export and back up your data from the source app before starting a migration.

## Import methods

- **JSON export**: In `spliit.app`, open the group and download the JSON export. Upload the file in the Spliit Cloud import wizard.
- **CSV export**: Same flow, with a `.csv` file. The Spliit parser reads the header row (Date, Description, Category, Currency, Cost, Original cost, Original currency, Conversion rate, Is Reimbursement, Split mode) and reconstructs participants and expenses. The group's default currency is the most common value across the per-row `Currency` column.
- **URL import**: Paste a `spliit.app` group URL. The API fetches and parses the export server-side, so the browser never contacts `spliit.app` directly.
- **Splitwise CSV export**: Select the **Splitwise** tab in the source step and drop a Splitwise CSV file. See [From Splitwise (CSV)](#from-splitwise-csv) for the full flow.

## From Splitwise (CSV)

Splitwise lets you export any group as a CSV file from the web app. In Spliit, select the **Splitwise** tab in the source step and drop the file onto the upload area (or click to pick it from disk).

The import wizard dispatches the parser from the active tab — the Spliit tab uses the Spliit parser, the Splitwise tab uses the Splitwise parser — so the file's format must match the tab. The Splitwise tab's file picker restricts selection to `.csv`, since Splitwise has no JSON export. The expected header is `Date,Description,Category,Cost,Currency,<participants…>`.

### Exporting from Splitwise

1. Open the Splitwise group in your browser.
2. Use the group's export option to download a CSV file.
3. The file contains one row per expense plus a `Total balance` summary row at the end.

### Importing into Spliit

1. Sign in to Spliit Cloud and open the import page.
2. On the source step, switch to the **Splitwise** tab.
3. Drop the CSV file (or click to select it).
4. Map the source participants to Spliit participants in the mapping step, choose the destination group's currency, and confirm.

### Multi-currency

Splitwise exports preserve the per-expense currency exactly as recorded. Each imported expense keeps its `originalCurrency` and `originalAmount` set to the value in the source row. The destination group's base currency is chosen in the destination step, and the existing Frankfurter-backed conversion handles the rest at confirm time. No rates are fetched during the source step.

The default group currency is pre-filled to whichever currency appears the most across the source rows, so a MKD-heavy export opens with MKD selected and an EUR-heavy export opens with EUR. The same rule applies to Spliit CSV imports.

### How the Splitwise values are decoded

Each per-participant cell in the CSV is `Paid − Owe` (Splitwise convention). The parser recovers the per-participant `Owe` so that the resulting `paidFor` shares sum exactly to the cost:

- A participant with a **negative** value paid nothing and consumed `−value`.
- Participants with **positive** values split the cost proportionally to their values; each one's `Owe` is `cost · (value / Σpositive) − value`.

The payer is whichever positive-value participant has the largest recovered `Paid` (typically the one who fronted the whole cost). This is why the parser's `paidBy` matches the convention used by the Splitwise web app, and why the resulting per-currency balances line up with the `Total balance` footer rows at the bottom of the export.

### Reimbursement detection

A row is imported as a reimbursement (no split) when either of the following matches:

- The `Category` column is `Payment`.
- The `Description` column matches the pattern `<Name> I. paid <Name> I.` (or `<Name> paid <Name>` for non-initialed names) — Splitwise's own "you paid someone" notation.

For these rows the parser picks the participant with the negative column value as the receiver (`paidFor`) and the positive-value participant as the payer, so the row imports cleanly even when Splitwise lists both sides of the transfer.

### Footer skip

Splitwise exports end with a `Total balance` summary row. The parser ignores it, so it is not imported as an expense. The integration test suite uses these footer rows as the oracle: it parses the export, recomputes the per-participant balances from the parsed expenses, and asserts that the result matches the footer's per-currency values to within one cent of rounding drift.

### Group name

If the export filename matches a known Splitwise pattern, the parser pre-fills the group name:

- `antonio-i-and-dejan-i_2026-06-30_export.csv` (personal export) → **John D. and Jane D.**
- `2026_2026-06-30_export.csv` and `_2026-06-30_export.csv` (group exports) → no name inferred, the field stays blank.

For group exports, type the group name in the destination step before confirming.

### Limitation

One CSV file produces one Spliit group. There is no auto-grouping of multiple Splitwise groups from a single export. If you have several Splitwise groups, export each one separately and import them one at a time.

## What gets imported

- **Group metadata**: name, currency
- **Participants**: name, color (all mapped by you in the wizard)
- **Expenses**: title, amount, date, payer, category, notes, split mode (evenly / by shares / by percentage / by amount), recurrence, reimbursement flag
- **Original currency fields**: `originalAmount`, `originalCurrency`, `conversionRate` are preserved from the source when available
- **Source trace**: an "Imported from `<sourceUrl>`" note on the group and an activity entry

## What is not imported

- Documents (receipts, attachments) — the `spliit.app` export does not include them
- The original activity feed / audit history
- Group membership or invitation state from the source

## What you need

- A `spliit.app` export file (JSON or CSV) or the group URL
- A Spliit Cloud account to own the imported group

## Import flow

1. Sign in to Spliit Cloud and open the import page.
2. Upload a JSON or CSV export, paste a `spliit.app` group URL, or swap `.app` for `.cloud` in the group URL (e.g. `https://spliit.app/groups/abc123` → `https://spliit.cloud/groups/abc123`).
3. For each source participant, choose a mapping: link to your account, invite by email, invite by link, leave unlinked, or (for existing-group imports) link to an existing participant.
4. Confirm. The group is created under your account.

After import, verify the totals on the **Balances** tab match the source. Spot-check a few expenses for amount, payer, and splits.

## Currency handling

When the source group's currency differs from the destination group's currency, the import converts each affected expense using real exchange rates from the Frankfurter provider. The wizard fetches a rate for each unique `(date, source currency, destination currency)` tuple. Each imported expense stores the converted `amount` in the destination currency, the `originalAmount` / `originalCurrency` from the source (for auditing), and the actual `conversionRate` that was applied.

If a source expense already carries `originalAmount` / `originalCurrency` from a prior conversion (e.g. originally entered in USD and converted to a EUR group), the import converts directly from the expense's original currency to the destination — it does not redo the chain through the source group's currency.

Same-currency imports are a no-op: original fields pass through unchanged and no rates are fetched.

CSV imports set the group's default `currencyCode` to the value detected from the source — the Spliit CSV reads the `Currency` column from the first valid row, the Splitwise CSV picks the most common currency across rows. Override it in the destination step if needed.

The confirm step blocks submission if any required rate is unavailable (unsupported currency, provider error).

## What to do if something looks off

- **Balances are off by a small amount**: likely a rounding difference from uneven splits (e.g. a three-way split of 100 produces 33 + 33 + 34). Cross-check with the source.
- **Currency amounts look wrong**: check the `originalAmount`, `originalCurrency`, and `conversionRate` fields on the imported expense to trace how the conversion was applied. The rate is fetched from the Frankfurter provider on the expense's date.
- **Original currency metadata seems incorrect**: the original `spliit.app` implementation may have stored inconsistent currency metadata across expenses. Compare against the source's original-cost fields.
- **Documents (receipts, attachments) are missing**: the `spliit.app` export does not include documents, so they are not imported. Re-upload them in the destination group if needed.
- **A participant name is wrong**: edit the participant in the group; the import does not dedupe names except via the explicit mapping step.

If you hit a problem not covered here, open an issue with the export (or a redacted version) and a description of what you saw.

## Exporting from Spliit Cloud

Group and user data export is available. The same JSON shape used by the import path is used for export, so migration off Spliit Cloud is possible without lock-in.

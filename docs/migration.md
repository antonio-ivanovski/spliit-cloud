# Migration to Spliit Cloud

This guide covers importing a group from another expense-splitting app. The import system supports six sources: a `spliit.app` group URL that the server fetches on your behalf, a `spliit.app` JSON or CSV export, a Splitwise CSV export, a Cospend project CSV export, a Tricount share link or GDPR CSV export, and a Settle Up CSV history export.

> Always export and back up your data from the source app before starting a migration.

## From Spliit (link or file)

The **Spliit** tab offers two ways in — a group link (fastest) or a downloaded export file:

- **Group link**: Open the group on `spliit.app`, copy the group URL, and paste it into the import wizard. Our server fetches the group through the `spliit.app` public export endpoint on your behalf, so the browser never contacts `spliit.app` directly. Change `.app` to `.cloud` in any `spliit.app` group URL to import it into Spliit Cloud.
- **File export**: Open the group on `spliit.app`, open group settings, and download JSON (CSV works too). JSON preserves every amount and payer exactly and keeps recurring expenses; CSV is a fallback that rounds each per-participant amount to 2 decimals and drops recurrence.

## From Splitwise (CSV)

Splitwise lets you export any group as a CSV file from the web app. In Spliit, select the **Splitwise** tab in the source step and drop the file onto the upload area (or click to pick it from disk).

The import wizard dispatches the parser from the active tab — the Spliit tab uses the Spliit parser, the Splitwise tab uses the Splitwise parser — so the file's format must match the tab. The Splitwise tab's file picker restricts selection to `.csv`, since Splitwise has no JSON export. The expected header is `Date,Description,Category,Cost,Currency,<participants…>`.

### Exporting from Splitwise

1. Open the Splitwise group on splitwise.com in a desktop browser. The mobile apps have no export.
2. Click the gear icon at the top of the group page, then choose “Export as spreadsheet”.
3. Download the CSV. The file contains one row per expense plus a `Total balance` summary row at the end (skipped on import).

### Importing into Spliit Cloud

1. Sign in to Spliit Cloud and open the import page.
2. On the source step, switch to the **Splitwise** tab.
3. Drop the CSV file (or click to select it).
4. Map the source participants to Spliit Cloud participants in the mapping step, choose the destination group's currency, and confirm.

### Multi-currency

Splitwise exports preserve the per-expense currency exactly as recorded. Each imported expense keeps its `originalCurrency` and `originalAmount` set to the value in the source row. The destination group's base currency is chosen in the destination step, and the existing Frankfurter-backed conversion handles the rest at confirm time. No rates are fetched during the source step.

The default group currency is pre-filled to whichever currency appears the most across the source rows, so a MKD-heavy export opens with MKD selected and an EUR-heavy export opens with EUR. The same rule applies to Spliit CSV imports.

### How the Splitwise values are decoded

Each per-participant cell in the CSV is `Paid − Owe` (Splitwise convention). The parser recovers the per-participant `Owe` so that the resulting `paidFor` shares sum exactly to the cost:

- A participant with a **negative** value paid nothing and consumed `−value`.
- Participants with **positive** values split the cost proportionally to their values; each one's `Owe` is `cost · (value / Σpositive) − value`.

The payer is whichever positive-value participant has the largest recovered `Paid` (typically the one who fronted the whole cost). This is why the parser's `paidBy` matches the convention used by the Splitwise web app, and why the resulting per-currency balances line up with the `Total balance` footer rows at the bottom of the export.

### Settlement detection

A row is imported as a settlement (no split) when either of the following matches:

- The `Category` column is `Payment`.
- The `Description` column matches the pattern `<Name> I. paid <Name> I.` (or `<Name> paid <Name>` for non-initialed names) — Splitwise's own "you paid someone" notation.

For these rows the parser picks the participant with the negative column value as the receiver (`paidFor`) and the positive-value participant as the payer, so the row imports cleanly even when Splitwise lists both sides of the transfer. The legacy `isReimbursement` import flag is accepted only as an alias that maps onto the settlement category.

### Footer skip

Splitwise exports end with a `Total balance` summary row. The parser ignores it, so it is not imported as an expense. The integration test suite uses these footer rows as the oracle: it parses the export, recomputes the per-participant balances from the parsed expenses, and asserts that the result matches the footer's per-currency values to within one cent of rounding drift.

### Group name

If the export filename matches a known Splitwise pattern, the parser pre-fills the group name:

- `antonio-i-and-dejan-i_2026-06-30_export.csv` (personal export) → **John D. and Jane D.**
- `2026_2026-06-30_export.csv` and `_2026-06-30_export.csv` (group exports) → no name inferred, the field stays blank.

For group exports, type the group name in the destination step before confirming.

### Limitation

One CSV file produces one Spliit Cloud group. There is no auto-grouping of multiple Splitwise groups from a single export. If you have several Splitwise groups, export each one separately and import them one at a time.

## From Tricount (share link or GDPR CSV)

In Spliit, select the **Tricount** tab in the source step. Two ways in:

- **Share link (fastest)**: paste a Tricount share link (`https://tricount.com/t…`, from the sharing menu in the app, "Other" option). Spliit fetches the group server-side — no GDPR request needed.
- **GDPR CSV**: request a data export under GDPR terms from Tricount support (profile tab → chat button in the Tricount app); the support team emails you a CSV dump of your groups. Drop the dump onto the upload area (or click to pick it from disk).

### Multi-group dumps

Unlike Splitwise, one Tricount dump can hold several groups: each group section ends with a `tricount <name> - Exported on …` footer row carrying the group name. When the parser finds more than one group, a picker lists each group with its participant and expense counts. Select the groups to import — each goes through destination, mapping, currency conversion, and confirm in turn, with participant mappings remembered by name between groups.

### How the Tricount values are decoded

The GDPR core columns are `Title, Amount, Currency, Exchange rate, Amount in default currency (<CODE>), Transaction type, Category, Paid by, Date & time`, plus one `Paid by <Name>` / `Impacted to <Name>` column pair per participant. The same file in Sesterce shape (`Date, Title, Paid by <Name>…, Paid for <Name>…, Currency, Category, Exchange rate`) is accepted too.

- **Amounts**: expenses are signed negative, incomes positive (exporter convention). The parser normalizes to a positive cost in the row's `Currency`.
- **Splits**: each member's `Impacted to` value is their owed share; shares are computed through the domain serializers so they sum exactly to the cost.
- **Settlements**: rows with `Transaction type` `BALANCE` (or transfer-like titles such as repayment/reimbursement/`recouvrement de dette`) import as settlements (payer → single receiver).
- **Categories**: Tricount built-in categories (EN/FR) map to Spliit categories; custom categories fall back to General, `UNCATEGORIZED` to General.
- **Exchange rate**: the row's historical rate is preserved on the expense for auditing. Conversion to the destination currency happens at confirm time via the existing Frankfurter-backed conversion step — same contract as Splitwise imports.

### Limitation

Documents (receipts, attachments) are not part of the CSV dump and are not imported. Re-upload them in the destination group if needed.

## From Cospend (CSV)

Cospend exports one CSV per project. In Spliit, select the **Cospend** tab in the source step and drop the file onto the upload area (or click to pick it from disk).

### Exporting from Cospend

1. Open the project in Cospend, then open the project menu.
2. Choose to export the project as CSV. Cospend exports one file per project.
3. Download the CSV. Exports without a currency section default to EUR — check the currency in the destination step.

## From Settle Up (CSV)

Settle Up exports one group history as a CSV file. Open the group in Settle Up, open the group menu, choose Export, and email the CSV history to yourself. Save the attachment, then select the **Settle Up** tab in the source step and drop the file onto the upload area (or click to pick it from disk).

The expected header is `"Who paid","Amount","Currency","For whom","Split amounts","Purpose","Category","Date & time","Timezone","Exchange rate","Converted amount","Type","Receipt"`. The `For whom` / `Split amounts` pair is what distinguishes this layout: each holds a `;`-separated list — member names and their aligned owed amounts. The file is UTF-16 with a BOM (uploads are decoded before parsing). Rows work empty `Purpose` cells: those import with a `Payer → receivers` fallback title.

### How the Settle Up values are decoded

- **Amounts**: `Amount` is denominated in `Currency`. The parser normalizes to a positive cost; negative rows import with the income category. Only rows in the export's dominant currency are imported, so one group lands in one currency.
- **Settlements**: rows with a transfer `Type` (or transfer-like titles such as repayment/reimbursement) import as settlements (payer → single receiver).
- **Categories**: Settle Up built-in category emoji map to Spliit categories; custom names match by keyword, unknown ones fall back to General.
- **Exchange rate**: the row's historical rate is preserved on the expense for auditing. Conversion to the destination currency happens at confirm time via the existing Frankfurter-backed conversion step — same contract as Splitwise imports.

### Group name

Settle Up exports carry no group name in the file body, so the parser defaults to "Imported from Settle Up" and refines it from the attachment filename (e.g. `my-trip.csv` → "My Trip"). Override it in the destination step if needed.

### Limitation

One CSV file produces one Spliit Cloud group. Receipt images are not part of the CSV export and are not imported. Re-upload them in the destination group if needed.

## From Spliit Cloud (account backup or group bundle)

The **Spliit Cloud** tab imports a `.spliit.zip` bundle. Open Account settings → Backups & export (multiple groups) or a group's Export section (single group), choose the groups and content, then choose Download backup or Download bundle. Drop the `.spliit.zip` file onto the upload area — you'll pick which groups to import in the next step.

## What gets imported

- **Group metadata**: name, currency
- **Participants**: name, color (all mapped by you in the wizard)
- **Expenses**: title, amount, date, payer, category, notes, split mode (evenly / by shares / by percentage / by amount), recurrence, settlement category (legacy CSV `Is Reimbursement` maps to settlement)
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

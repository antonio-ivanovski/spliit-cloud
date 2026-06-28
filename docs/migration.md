# Migration from original Spliit

This guide covers importing a `spliit.app` group. The import system supports three sources: JSON export, CSV export, or a `spliit.app` group URL that the server fetches on your behalf.

> Always export and back up your data from the source app before starting a migration.

## Import methods

- **JSON export**: In `spliit.app`, open the group and download the JSON export. Upload the file in the Spliit Cloud import wizard.
- **CSV export**: Same flow, with a `.csv` file. The parser reads the header row (Date, Description, Category, Currency, Cost, Original cost, Original currency, Conversion rate, Is Reimbursement, Split mode) and reconstructs participants and expenses.
- **URL import**: Paste a `spliit.app` group URL. The API fetches and parses the export server-side, so the browser never contacts `spliit.app` directly.

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

CSV imports set `currencyCode` to `null` because the CSV format does not carry a group-level currency code, so cross-currency conversion is skipped and the CSV columns pass through as-is.

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

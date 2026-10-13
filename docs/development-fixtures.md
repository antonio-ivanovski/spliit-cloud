# Development fixtures

The opt-in `bun seed:dev` command creates synthetic data for manual feature
checks. It uses the current database schema; it does not require the API or
start any services. Migrate your local development database first and sign in
once to create the account that will receive the demo groups.

```bash
# Inspect scenarios without connecting to the database.
NODE_ENV=development bun seed:dev --account=you@example.test --dry-run

# Attach fixtures to your existing local account (email or account ID).
NODE_ENV=development bun seed:dev --account=you@example.test

# Discard edits to this account's demo groups and recreate them.
NODE_ENV=development bun seed:dev --account=you@example.test --reset

# Remove this account's demo groups, including any expenses added to them.
NODE_ENV=development bun seed:dev --account=you@example.test --clean
```

Refresh `/groups` while signed in to the selected account. Group IDs are printed
so you can also open `/groups/<groupId>` directly. The selected account's profile,
preferences, authentication, and other groups are preserved. No seed runs
automatically. `NODE_ENV` must equal `development` and the write target must be
an explicit PostgreSQL URL using `localhost`, `127.0.0.1`, or `::1`, without query parameters. For Compose,
run the command on the host through the mapped database port. These checks are
local-development safeguards; do not point a loopback tunnel at production.

Default runs skip existing demo groups, preserving manual edits. Reset and clean
delete only the fixed fixture IDs for the selected account, including any
additional records you attached to those demo groups. Renaming a demo group does
not protect it from reset/clean. Reset replaces the complete fixture set in one
transaction; a failure rolls back the changes. Commands for the same account are
serialized. Dates are relative to the day of creation; reset refreshes old data.

Four synthetic peers are created per selected account. Their emails are printed
by the command; they end in `@example.test`. Use local magic-link email delivery
(Maildev in the standard setup) to sign in as a peer and check admin/member
permissions in another browser. No passwords, sessions, OAuth tokens, or
passkeys are fabricated. Clean deliberately retains peer accounts, including
their credentials and any unrelated groups created during manual testing.

## Scenarios and checks

| Scenario                    | Data and manual checks                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared household            | Thirteen months of rent, utilities, and income; 90 days of groceries; personal and viewer-excluded expenses. Check personal/shared homepage totals, periods, category/participant filters, charts, starred groups, and balances. Includes weekly/monthly/yearly/custom budgets, selected categories/participants, an over-budget limit, group split default, comments, and all four recurrence statuses/frequencies.                          |
| Holiday split playground    | Equal, weighted, percentage, exact-amount, and itemized splits; all four payer split modes with two payers; one-cent rounding; custom/proportional tips; exchange/custom/exact conversion snapshots; partial settlement; Unicode titles and multiline notes; two subgroups; pending/accepted/declined/revoked invitations; public view key. Check editing, previews, balances, subgroup settlement, sharing, invitations, and narrow screens. |
| Imported participants       | Forty-five uncategorized expenses, four name-only participants (one removed), null-owned historical expenses. Check member linking, category review/bulk categorization, name resolution, removed-participant history, and admin management of imported expenses. Linking changes can be repeated after reset.                                                                                                                                |
| Friend: Alex Rivera         | Two active accounts, USD dinner, income, and partial repayment. Check the Friends section, per-viewer display name, and friend-specific actions/restrictions.                                                                                                                                                                                                                                                                                 |
| Settled weekend             | EUR hotel and full repayment yield exactly zero balances. Check settlement empty states and ordinary archiving.                                                                                                                                                                                                                                                                                                                               |
| Archived trip with balances | GBP flights and outstanding debt. Check archived navigation, read-only behavior, unarchiving, and archive treatment in statistics.                                                                                                                                                                                                                                                                                                            |
| Hidden club                 | A per-account hidden group with an expense. Check hidden-group recovery and distinction from group archiving.                                                                                                                                                                                                                                                                                                                                 |
| Empty group                 | One member, no expenses. Check onboarding, empty expense lists, charts, and zero balances.                                                                                                                                                                                                                                                                                                                                                    |
| Member permissions          | Your account is a MEMBER; Alex is ADMIN. Both accounts own an expense. Check expense ownership and settings/budget/member permissions.                                                                                                                                                                                                                                                                                                        |
| Custom currency             | Non-ISO `tokens` ledger. Check formatting, custom-currency buckets, and conversion restrictions.                                                                                                                                                                                                                                                                                                                                              |
| Large history & categories  | 360 USD expenses, rotating payers, all ordinary category IDs, and eighteen months of history. Check pagination, search, filters, reports, CSV/ZIP exports, category coverage, and chart granularity.                                                                                                                                                                                                                                          |

Amounts use integer minor units; percentages use basis points; weighted shares
use fixed units (`100` = one share). Conversion examples persist a fixed USD/EUR
snapshot so they work offline and remain reproducible. Expenses use noon UTC
except a Tokyo-local midnight boundary example. The same fixture patterns and
IDs are deterministic for a given account and date.

## Checks that need real interaction or services

Seeding writes directly to the database. It checks ordinary expense payloads
against the domain schema but does not exercise create/import API behavior.
Test creation, update, deletion, and import flows through the app separately.
The imported scenario supplies historical data to link/categorize; use an
exported demo group as a real import sample when testing the importer.

Receipt upload/download and AI receipt/voice features need real files and their
configured services. The seed does not create broken document URLs. AI bulk
categorization has uncategorized source data, but still needs AI configuration.
Public views can be opened through the seeded trip's sharing controls; saved
public bookmarks and link-invite acceptance should be exercised through the UI.

No delivery jobs, webhook endpoints, push subscriptions, recovery secrets,
account-deletion requests, or authentication artifacts are seeded. Notifications,
webhooks, OAuth, passkeys, and recovery require actual interaction and configured
local services. Activities are present for browsing but direct seed writes do
not dispatch notifications.

Morgan's pending holiday invitation targets the fourth demo peer account, so
signing in as that peer lets you exercise invitation acceptance. The household
has a shared beneficiary preset and a personal payer preset to check defaults
and inheritance.

The active monthly recurrence is scheduled after its seed date. Once due, the
normal worker can create additional demo expenses. Budget notification behavior
also uses the normal worker; create/edit an expense to test the event pipeline.
Run reset when you need to restore the original dataset.

## Extending fixtures

Scenario definitions live in `packages/db/src/dev-seed/fixtures.ts`; related
budgets, memberships, activities, presets, and series live in `seed.ts`. Keep
scenario keys stable so cleanup can still find existing demo groups. Add data
through the same helpers so domain validation continues to catch invalid shares
and item totals. Update this guide with the observable behavior a new scenario
helps maintainers inspect. No schema migration is required for this seed command.

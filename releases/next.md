Welcome to `vNEXT`! One or two sentences on what this release is about.

## Highlights

- Headline one
- Rich link previews for group invites and shared views

### Headline one

A short paragraph per headline, with a screenshot where it helps.

![caption](./assets/next/shot.webp)

### Rich link previews for group invites and shared views

Sharing a group invite link or a read-only view link now unfurls a card with the group's emoji, name, member count, and inviter — rendered as a 1200×630 image with the group's own colors and member avatars. Friend-ledger invites get their own two-avatar card, and used-up links gracefully fall back to a generic card instead of leaking details.

![Group invite link preview](./assets/next/og-group-invite.png)

## What's Changed

### 🚨 Breaking Changes

Omit this section when there are none. Each entry names what breaks,
who is affected, and the exact migration steps.

### 🚀 Features

- Short entry per user-facing change (`TBD` by @TBD)
- Group invite links and read-only view links now unfurl rich social previews: the shared card shows the group name, emoji, member count, inviter, and member avatars (friend-ledger invites get a two-avatar variant), with used-up links falling back to a generic card (`TBD` by @TBD)
- Expense notifications now include more context: new-expense emails show the category, who paid, and the group size, and push alerts include the amount, group, and payer alongside your personal share (`TBD` by @TBD)
- Groups can now set a default entry currency separate from the settlement currency: new expenses start in the trip currency for fast entry but still settle in the home currency. Thanks @alopix for opening [#160](https://github.com/antonio-ivanovski/spliit-cloud/issues/160) (`TBD` by @TBD)
- Groups can now swap the settlement currency after expenses exist: Tools → Swap currency converts every expense with per-currency-pair rates (per expense date or one fixed rate per pair, mirroring the importer), shows a per-row preview, and then flips the ledger. Picking a different currency in group settings jumps straight into the tool with the choice preselected. Rate failures now surface per currency pair with a cheap single-pair retry and a per-pair fixed-rate fallback. The review step shows only expenses that need attention, with the full per-expense list one click away in a dialog. The tool is ADMIN-only and stays disabled while offline or on archived groups. Thanks @alopix for opening [#160](https://github.com/antonio-ivanovski/spliit-cloud/issues/160) (`TBD` by @TBD)
- Per-date conversions involving a withdrawn currency (BGN, HRK) now offer an explicit fixed-rate fallback: the pair card stays in per-date mode by default with a checked "use the fixed conversion when a market rate is missing" option, shows a compact "{n} of {total} dates use the fixed conversion" summary instead of the full warning when every date resolves, and stays quiet for all-market histories. Unchecking it resolves post-withdrawal dates as missing rates instead — in the swap tool, the importer, and their previews. Expenses converted through the fallback now raise a warn-only "Needs attention" flag with a distinct fixed-conversion note: per-row in the swap preview and full-list dialog (which never blocks Continue), and per-pair in the import confirm summary (`TBD` by @TBD)
- Receipts can now be shared straight into Spliit from other Android apps: sharing a receipt photo or document to the installed Spliit app opens a page where you pick the group or friend, then either scan it with AI or attach it to a manually created expense. Shared text can be attached as a note the same way. Thanks @alopix for opening [#159](https://github.com/antonio-ivanovski/spliit-cloud/issues/159) (`TBD` by @TBD)

### 🐛 Bug fixes

- Receipt scan preview no longer warns when items differ from the total by rounding: gaps within the currency's rounding tolerance resolve to the receipt total with a muted rounding note instead of the mismatch warning (`TBD` by @TBD)
- Expenses and imports in Bulgarian lev (BGN) convert again after its euro adoption: post-2026 rates resolve through the irrevocable 1 EUR = 1.95583 BGN conversion (frozen last quote when available, triangulated live euro rate otherwise), with the fixed rate explained in place instead of a missing-rate error. Croatian kuna (HRK) gets the same treatment at 1 EUR = 7.5345 HRK (`TBD` by @TBD)
- Withdrawn currencies now warn instead of whispering: any rate involving a withdrawn code (frozen last quote, pure fixed conversion, or fixed-plus-live triangulation) shows an amber banner naming the currency, the withdrawal date, and the statutory rate with a reference link — in the expense form, the importer, the currency swap tool, and the converter. The fixed-rate mechanism itself is generic now (euro adoption, redenomination, replacement, or plain withdrawal), with per-currency references instead of one ECB link (`TBD` by @TBD)
- Currency swap review rows now stretch full width in the review step and the All-expenses dialog: the Was/rate/Becomes grid drops its empty track so long amounts and fixed-conversion notes stop truncating (`TBD` by @TBD)
- Home, expenses, and group pages now load without flashes or duplicate requests: pending states hold their layout, filter changes keep prior results, the stats period persists in the URL, and offline snapshots swap in cleanly (`TBD` by @TBD)
- Split by amount no longer wipes custom shares when the expense total changes: uneven splits survive amount edits as a footer mismatch, and Paid for / Paid by now offer Set expense amount to derive the total from the entered shares. Thanks @Commit25uccess for opening [#156](https://github.com/antonio-ivanovski/spliit-cloud/issues/156) (`TBD` by @TBD)

**Full Changelog**: TBD

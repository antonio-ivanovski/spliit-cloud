Welcome to `vNEXT`! One or two sentences on what this release is about.

## Highlights

- Headline one

### Headline one

A short paragraph per headline, with a screenshot where it helps.

![caption](./assets/next/shot.webp)

## What's Changed

### 🚨 Breaking Changes

Omit this section when there are none. Each entry names what breaks,
who is affected, and the exact migration steps.

### 🚀 Features

- Short entry per user-facing change (`TBD` by @TBD)
- Groups can now set a default entry currency separate from the settlement currency: new expenses start in the trip currency for fast entry but still settle in the home currency. Thanks @alopix for opening [#160](https://github.com/antonio-ivanovski/spliit-cloud/issues/160) (`TBD` by @TBD)
- Groups can now swap the settlement currency after expenses exist: Tools → Swap currency converts every expense with per-currency-pair rates (per expense date or one fixed rate per pair, mirroring the importer), shows a per-row preview, and then flips the ledger. Picking a different currency in group settings jumps straight into the tool with the choice preselected. Rate failures now surface per currency pair with a cheap single-pair retry and a per-pair fixed-rate fallback. The review step shows only expenses that need attention, with the full per-expense list one click away in a dialog. The tool is ADMIN-only and stays disabled while offline or on archived groups. Thanks @alopix for opening [#160](https://github.com/antonio-ivanovski/spliit-cloud/issues/160) (`TBD` by @TBD)

### 🐛 Bug fixes

- Receipt scan preview no longer warns when items differ from the total by rounding: gaps within the currency's rounding tolerance resolve to the receipt total with a muted rounding note instead of the mismatch warning (`TBD` by @TBD)

**Full Changelog**: TBD

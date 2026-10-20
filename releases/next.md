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
- Multi-person invite links let several people join with one URL, with optional join limits and expiry; the default is unlimited joins for seven days. Members can copy links again, and creators or admins can edit limits, rotate links, or revoke them (`TBD` by @TBD)
- Bulk categorize now propagates into recurring series: per-series Selected only / This and future / Whole series picker, with the series template rewritten so future occurrences keep the new category. Already-diverged rows converge to the same destination on propagate scopes (`TBD` by @TBD)
- Currency swap now converts recurring templates at today's rate alongside expenses (all series statuses) instead of leaving them stale (`TBD` by @TBD)
- Recurring series list flags diverged templates whose occurrences drifted from the template category, with the badge also shown on the expense detail and series dialog (`TBD` by @TBD)
- File import confirm step notes when collapsed recurring rows differ only by category — the latest row's category wins (`TBD` by @TBD)

### 🐛 Bug fixes

- Anonymous access is now the first option, with clearer getting-started wording and branded social sign-in buttons. Reported by @sepulzera in [#162](https://github.com/antonio-ivanovski/spliit-cloud/issues/162) (`TBD` by @antonio-ivanovski)

- OAuth API access now works when Cloudflare challenges the server’s public signing-key endpoint, including after token refresh. Reported by @wi1k1n in [#161](https://github.com/antonio-ivanovski/spliit-cloud/issues/161) (`TBD` by @TBD)

- Group viewing and invitation links keep their access tokens through sign-in, signup, profile setup, and recovery, including emailed callbacks opened on another device. Choosing “Sign in to accept” joins the group after setup; opening an invitation otherwise still asks for confirmation (`TBD` by @TBD)
- Anonymous setup uses one stable profile and safeguard flow, avoiding lost display names and misleading “Downloads need updating” warnings. A late friends response no longer switches away from the invitation method you selected (`TBD` by @TBD)
- Offline downloads resume reliably after connectivity interruptions even when a status or cross-tab notification fails (`TBD` by @TBD)
- The What's new dialog and announcement emails now only reach accounts created before the announcement's publication date, so people who sign up later are not shown news that predates them (`TBD` by @TBD)

**Full Changelog**: TBD

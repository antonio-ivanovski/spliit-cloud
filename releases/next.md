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

- Group activity feed now records emoji and color changes, subgroup create/rename/delete, shared split-preset changes and group defaults, newly added participants, and friend invite creation/accepts. Expense comments no longer create feed rows but still send notifications (`TBD` by @TBD)
- Expense added/updated email and push notifications now include your personal share ("You owe X · You paid Y", or "You lent/borrowed X" for settlements). Thanks @KihtrakRaknas for opening [#148](https://github.com/antonio-ivanovski/spliit-cloud/issues/148) (`TBD` by @TBD)

### 🐛 Bug fixes

- Friend, member, and import dropdowns now keep showing names instead of raw IDs after selection (`TBD` by @TBD)
- `AI_SYSTEM_ONE_BASE_URL` now requires HTTPS, except for local loopback development (`http://localhost`, `http://127.0.0.1`). A remote plaintext HTTP endpoint fails boot instead of sending the bearer key and expense context in cleartext — switch those endpoints to HTTPS (`TBD` by @TBD)
- Opening an expense from the activity tab now shows the preview over the activity feed and keeps your scroll position, including after editing. Thanks @KihtrakRaknas for opening [#142](https://github.com/antonio-ivanovski/spliit-cloud/issues/142) (`TBD` by @TBD)

**Full Changelog**: TBD

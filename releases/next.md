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

### 🐛 Bug fixes

- Fixed PWA auto-zoom on iOS by keeping form fields at 16px so focusing an input no longer zooms the page. Thanks @KihtrakRaknas for reporting (#129) (`TBD` by @TBD)
- Made crypto currency conversion more trustworthy: bridged rates (e.g. DOGE→MKD via EUR) now report the oldest leg's date so the stale-rate warning works, reversed quotes are marked as inverted in the rate sources, future dates consistently resolve at today's rate on the server, and invalid dates return a proper validation error instead of a provider failure (`TBD` by @TBD)
- Fixed “Invalid Participant ID” error when editing an expense that includes a removed participant: the edit form round-trips stored participant IDs, so a no-op resave (including itemized splits) no longer fails after a member is deleted. Removed participants are kept on expenses they were part of. Thanks @KihtrakRaknas for reporting (#128) (`TBD` by @TBD)

**Full Changelog**: TBD

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

- Show an accurate "Spliit can't be reached" warning with a status-page link when the API is down instead of incorrectly telling online users they are offline. Self-hosted instances can point it at their own status page via `VITE_STATUS_PAGE_URL`, or leave it unset to hide the link (`TBD` by @TBD)
- Fixed adding a passkey failing on older sign-ins: the Add button now asks for a fresh sign-in first and brings you back to account settings to finish, instead of failing with a stale-session error (`TBD` by @TBD)

**Full Changelog**: TBD

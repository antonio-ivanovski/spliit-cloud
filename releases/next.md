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

- The expense form now starts compact, with inline split details on mobile and a live split panel on desktop. Notes, receipts, recurring schedules and items stay available on demand; choose Expanded in app preferences to keep more details visible. (`TBD` by @TBD)
- New expenses now open with the title field focused, and Enter in the title moves to the amount for faster manual entry, while copies, settlements, imports, and other prefilled flows keep their existing focus behavior ([#171](https://github.com/antonio-ivanovski/spliit-cloud/issues/171), thanks @eikaramba). (`TBD` by @TBD)

### 🐛 Bug fixes

- Guest account deletion no longer sends email to synthetic addresses or claims a confirmation email was sent. (`TBD` by @TBD)
- Password reset from the sign-in flow now completes on Docker Compose deployments: the web container forwards the reset form submission to the API instead of rejecting it with 405 ([#175](https://github.com/antonio-ivanovski/spliit-cloud/issues/175), thanks @yhterrance). (`TBD` by @TBD)

**Full Changelog**: TBD

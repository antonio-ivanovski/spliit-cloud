Welcome to `vNEXT`! One or two sentences on what this release is about.

## Highlights

- Activity tab is now personal
- Delete your account with a 48-hour safety net

### Activity tab is now personal

The Activity tab mirrors the expenses timeline: a `For you / All` toggle, inline `N hidden activities not involving you` rows, and a per-row `Your share:` line under each expense.

![Activity tab with For you toggle and a collapsed hidden-activity row](./assets/next/activity-for-you.webp)

### Delete your account with a 48-hour safety net

Account settings has a new Danger zone with a dedicated Delete account review page. Choose whether shared history keeps your name or shows “Deleted member”, and whether remaining balances stay as they are or are marked settled when deletion runs. You see per-group consequences before typing DELETE to schedule, and you can cancel any time during the 48-hour waiting period while your account stays active.

![Delete account entry point in the account settings Danger zone](./assets/next/delete-account.webp)

![Scheduled deletion with cancel option and a banner across the app](./assets/next/account-deletion-scheduled.webp)

## What's Changed

### 🚨 Breaking Changes

Omit this section when there are none. Each entry names what breaks,
who is affected, and the exact migration steps.

### 🚀 Features

- Added a Support page (`/support`, with a Markdown companion and sitemap entry) as the public support contact for the app and the ChatGPT plugin listing (`TBD` by @TBD)
- Expense deletes now offer a plain confirmation mode: switch Account settings → Expense delete confirmation to Confirmation dialog to delete expenses with a simple confirm instead of typing the title, while deleting a group or removing a member always requires typing. Typed expense delete dialogs link straight to the setting (`TBD` by @TBD)
- Activity tab is now personal: expense rows show your share (`Your share:`) or `You are not involved`, and a `For you / All` toggle with inline `N hidden activities not involving you` rows mirrors the expenses timeline. Past activity rows were backfilled with participant data where recoverable. Thanks @KihtrakRaknas for opening [#150](https://github.com/antonio-ivanovski/spliit-cloud/issues/150) (`TBD` by @TBD)
- Hardened the privacy notice with data categories, purposes, recipients, retention, connected-application disclosure, and user controls (`TBD` by @TBD)
- Delete your account from a dedicated review page, with a 48-hour cancellation period while your account stays active (`TBD` by @TBD)
- Curated Updates now introduce selected releases once per account and keep past announcements in an in-app archive. Spliit Cloud news email can be switched off in notification settings or from any campaign email. (`TBD` by @TBD)

### 🐛 Bug fixes

- Fixed magic-link signup on invite-only instances when the group invitation is nested inside a sign-in redirect. Thanks @natekspencer for opening [#151](https://github.com/antonio-ivanovski/spliit-cloud/issues/151) (`TBD` by @TBD)
- Prepared the ChatGPT plugin directory submission: password-first reviewer login without guest accounts, configurable domain-verification token, and a versioned submission package with review cases (`TBD` by @TBD)

**Full Changelog**: TBD

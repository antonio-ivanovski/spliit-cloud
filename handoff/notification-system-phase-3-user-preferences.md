# Notification System Phase 3 — User Preferences Handoff

Status: implemented in the `push-notifications` delivery work.

## Delivered API and unsubscribe contract

- `notifications.preferences.get` returns per-row recommendations, effective
  channels, push-target availability, and whether Email is available for the
  account.
- `notifications.preferences.save` accepts a partial list of per-row category
  updates in one transaction. `channels: null` deletes that override and
  restores the recommended channels; rows omitted from the list are preserved.
- Optional email messages may carry RFC 8058 `List-Unsubscribe` headers and a
  signed `/email/unsubscribe?token=...` URL. GET renders confirmation only;
  POST requires the exact `List-Unsubscribe=One-Click` body and idempotently
  removes EMAIL while preserving PUSH. Authentication, invitation, and other
  mandatory mail do not use these links.

## Definition

Allow each account to choose one or more delivery channels for each user-facing
notification category: `[PUSH]`, `[EMAIL]`, `[PUSH, EMAIL]`, or `[]` (disabled).
Existing transactional and
onboarding emails remain mandatory and are not controlled by these preferences.

Out of scope: quiet hours, digests, group-specific overrides, and an in-app
notification inbox.

## Proposal

Keep notification categories separate from raw activity types so product copy
can evolve without coupling preferences to database event names. Resolve each
recipient with this precedence:

```text
recommended channels → account preference → resolved channels
```

Accounts with no overrides use the compact optimized defaults: group invites
use Email + Push, while direct friend additions and expense activity use Push.
Missing Push targets never turn into Email delivery; the delivery is skipped and
the settings warning remains visible. Placeholder-email accounts cannot select
Email until email configuration exists.

Expose an account-scoped settings UI with short rows grouped into Groups and
friends, Expenses, and Summaries. Each active row uses a responsive Email/Push
multi-select and auto-saves. Comments, weekly summaries, and Spliit Cloud news
are visible as disabled Coming soon rows until their producers exist.

## Implementation Notes

- Add an account-owned preference model keyed by shared notification category
  strings. Active categories are group invite received, friend added, expense
  created, and expense changed. Reserved categories cover comments, weekly
  summaries, and product updates. Each row has a `String[]` channel list
  (`EMAIL` and/or `PUSH`) and timestamps. Empty arrays disable that row; Zod
  guards reject unknown or duplicate channels without reordering them.
- Add protected list/update/reset procedures; derive the account from auth
  context and validate category names through shared domain schemas.
- Keep routing policy pure and testable: recipient, category, available
  channels, and preference produce the final channel set.
- Do not fall back to email for an explicit or recommended push-only preference.
  When no push target exists, skip that delivery and surface a persistent
  settings warning.
- There is no global preference row or inheritance UI. A null category override
  means the category's recommended policy.
- Selecting Push in settings enables and registers the current device before
  saving the row. A denied or failed permission request leaves the previous
  selection unchanged. Deselecting Push does not unregister the device because
  other rows may still use it.
- Coordinate launch onboarding with the PWA install promotion so dialogs do not
  compete. iOS installation guidance remains the prerequisite when push cannot
  run outside Home Screen mode.
- Add translations through the i18n CLI; never hand-edit locale JSON files.

## Future Decisions

- Decide whether categories can be overridden per group later.
- Define how newly introduced categories should be presented by older clients.

## Acceptance Criteria

- Users can view and update all preference-controlled categories.
- Routing honors account preferences without changing activity producers.
- Transactional/auth emails cannot be disabled by these settings.
- Defaults are stable for existing accounts and new categories are forward-safe.
- API, UI, and routing tests cover every channel combination and
  unavailable-channel condition.

## Suggested Sequence

1. Define category schema/defaults and preference resolution.
2. Add Prisma model/migration and protected API procedures.
3. Integrate resolver into durable delivery intent creation.
4. Build account settings UI and translations.
5. Add migration/default tests and end-to-end routing matrix coverage.

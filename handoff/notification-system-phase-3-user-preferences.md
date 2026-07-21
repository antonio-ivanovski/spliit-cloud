# Notification System Phase 3 — User Preferences Handoff

Status: planned; depends on Phase 2 durable delivery and Phase 1 routing.

## Definition

Allow each account to choose where each user-facing notification category is
delivered: push, email, both, or disabled. Existing transactional and
onboarding emails remain mandatory and are not controlled by these preferences.

Out of scope: quiet hours, digests, group-specific overrides, and an in-app
notification inbox.

## Proposal

Keep notification categories separate from raw activity types so product copy
can evolve without coupling preferences to database event names. Resolve each
recipient with this precedence:

```text
system default → account preference → resolved channels
```

Existing accounts inherit the current Phase 2 defaults. Preference changes
apply only to future deliveries; already-created delivery rows retain their
original channel intent.

Expose an account-scoped settings UI with one row per category and channel
choices for push/email. Explain unsupported or denied push separately from the
preference itself.

## Implementation Notes

- Add an account-owned preference model keyed by notification category, with a
  compact channel mode (`PUSH`, `EMAIL`, `BOTH`, `DISABLED`) and timestamps.
- Add protected list/update/reset procedures; derive the account from auth
  context and validate category names through shared domain schemas.
- Keep routing policy pure and testable: recipient, category, available
  channels, and preference produce the final channel set.
- Preserve email fallback behavior only where the selected mode includes email;
  a user selecting push-only accepts unavailable/denied push as a delivery
  limitation unless product later adds a separate fallback toggle.
- Add translations through the i18n CLI; never hand-edit locale JSON files.

## Risks / Open Decisions

- Decide whether push-only should silently drop when no device is registered or
  display a settings warning.
- Decide whether categories are global only or can be seeded per group later.
- Define how new categories inherit defaults and appear in older clients.

## Acceptance Criteria

- Users can view and update all preference-controlled categories.
- Routing honors account preferences without changing activity producers.
- Transactional/auth emails cannot be disabled by these settings.
- Defaults are stable for existing accounts and new categories are forward-safe.
- API, UI, and routing tests cover every channel mode and unavailable-channel
  condition.

## Suggested Sequence

1. Define category schema/defaults and preference resolution.
2. Add Prisma model/migration and protected API procedures.
3. Integrate resolver into durable delivery intent creation.
4. Build account settings UI and translations.
5. Add migration/default tests and end-to-end routing matrix coverage.

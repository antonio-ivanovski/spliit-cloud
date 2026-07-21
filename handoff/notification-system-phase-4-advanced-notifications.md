# Notification System Phase 4 — Advanced Notifications Handoff

Status: exploratory; depends on durable delivery. Phase 3 account-level
preferences and optional-email unsubscribe are implemented and provide the
baseline policy and delivery contract.

## Definition

Extend the notification platform with group-level controls, quiet hours,
digest delivery, an in-app inbox, unread badges, and localized notification
copy. These features should consume the same activity and delivery pipeline;
activity producers must remain unchanged.

Phase 3 already provides shared notification categories, account-scoped
channel overrides, Push-target availability, and a reset-to-system-default
semantics. The active producer categories are group invites, friend additions,
expense creation, and expense changes; comments, weekly summaries, and
product updates are reserved rows without producers today.

## Proposal

Treat delivery intent as the source of truth for what was addressed and add a
separate user-facing inbox/read model for what the user has seen. Group-level
overrides refine the existing account preference/default result only for
notifications scoped to that group, with explicit inherit semantics.
Quiet hours delay eligible non-urgent deliveries into a digest window while
security/account messages bypass the schedule.

The web client can use the existing PWA worker for badges and click-through,
while the API exposes unread counts and paginated inbox entries. Email digests
and push summaries should be generated from durable pending intent rather than
replaying activity queries ad hoc.

## Implementation Notes

- Add optional `(account, group, category)` overrides with explicit inherit
  semantics on top of the existing `(account, category)` preference rows.
  Preserve the shared category/channel validation and the existing
  system-default → account override → effective channel resolution contract.
- Keep missing Push targets from falling back to Email, and preserve the
  Phase 3 signed optional-email unsubscribe URL and RFC 8058 one-click
  contract when adding digest or other optional email delivery.
- Add timezone-aware quiet-hour rules and a digest scheduler with a clear
  urgent/non-urgent category classification.
- Add notification inbox rows/read markers, unread-count queries, and a
  retention/archive policy.
- Version localized payload templates and resolve locale at delivery time or
  snapshot it when intent is created; choose one policy consistently.
- Use notification tags/collapse keys to prevent repetitive push clutter and
  define badge-count reconciliation when notifications are opened elsewhere.
- Consider admin/system broadcasts only after account privacy and authorization
  boundaries are explicit.

## Risks / Open Decisions

- Define whether quiet hours use the account timezone or each device timezone.
- Set digest cadence, maximum batch size, and urgent-event exceptions.
- Decide inbox retention, search, and whether deleted-group events remain
  visible.
- Confirm localization snapshot semantics when a user changes language after
  an event is queued.

## Acceptance Criteria

- Group overrides, quiet hours, and digests compose predictably with the
  existing account preferences and durable delivery states; an explicit
  account choice remains effective unless a group override explicitly changes
  it.
- Inbox/read state is consistent across devices and does not expose inaccessible
  group data.
- Push badges and unread counts reconcile after notification clicks or reads on
  another device.
- Localized email/push/inbox content uses approved translation workflows.
- Load, retention, and privacy behavior are covered by integration tests.

## Suggested Sequence

1. Add group override and urgency/category metadata on the existing category
   and account-preference model.
2. Implement quiet-hour and digest scheduling on the durable worker.
3. Add inbox/read-state APIs and web surfaces.
4. Add badge/collapse behavior and localization snapshot policy.
5. Load-test, review privacy/retention, and roll out incrementally.

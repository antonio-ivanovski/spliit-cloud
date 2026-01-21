## Context

Notifications provide proactive alerts for group activity, without changing Spliit's core “no-auth” usage. Notifications are opt-in, per-group, and delivered only to explicitly configured destinations.

## Goals / Non-Goals

### Goals

- Per-group subscriptions to activity events
- Telegram is the MVP provider
- Subscriptions linked to a participant identity and skip notifications for the triggering participant
- Self-hosters can enable/disable via env vars + feature flag

### Non-Goals

- Mobile push notifications (requires native app)
- Building a general-purpose plugin SDK

## Decisions

### D1: Notification Subscription Model

**Decision**: Store subscriptions in Postgres, keyed by group + provider, with provider-specific JSON config.

### D2: Telegram Deep Link Onboarding

**Decision**: Use Telegram deep links (`t.me/{botName}?start={token}`) to avoid manual chat ID copying.

Flow:

1. User clicks "Connect Telegram" in Spliit UI
2. System generates time-limited token encoding groupId
3. UI links to `t.me/{botName}?start={token}`
4. User presses "Start" in Telegram
5. Bot receives `/start {token}`, captures chat ID
6. Bot validates token, completes subscription creation

## Event Types

Notifications cover the activity events already captured by the shared event bus (expense + group updates).

## Risks / Trade-offs

- Telegram setup friction -> Provide step-by-step self-host docs; deep links reduce user friction
- Provider reliability -> Surface delivery errors per subscription

## Open Questions

- Balance reminder frequency: daily/weekly/monthly; default weekly?

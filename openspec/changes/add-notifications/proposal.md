# Change: Add Group Notifications (Telegram MVP)

## Why

Users have no way to receive proactive alerts about group activity, which limits usability for teams and power users.

## What Changes

- Add per-group notification subscriptions behind `NEXT_PUBLIC_ENABLE_NOTIFICATIONS`
- Implement Telegram as the MVP notification provider (with deep link onboarding)
- Dispatch notifications from activity events emitted by the shared event system
- Add UI for managing notification subscriptions in group settings

## Impact

- Affected specs: `notifications`
- Affected code:
  - `src/lib/plugins/notifications/`
  - `src/trpc/routers/notifications/`
  - `src/app/groups/[groupId]/notifications/`
  - `src/app/api/telegram/webhook/route.ts`
  - `prisma/schema.prisma`
- Database: new notification subscription tables (additive)
- Self-hosting: requires `TELEGRAM_BOT_TOKEN` to enable Telegram provider

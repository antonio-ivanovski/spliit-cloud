## 0. Dependencies

- [x] 0.1 Event system exists and `logActivity()` emits events (`src/lib/events.ts`, `src/lib/api.ts`)
- [x] 0.2 Feature flag exists: `NEXT_PUBLIC_ENABLE_NOTIFICATIONS`

## 1. Database Schema

- [ ] 1.1 Add `NotificationSubscription` model to Prisma schema
- [ ] 1.2 Add `TelegramLinkToken` model to Prisma schema
- [ ] 1.3 Create and run database migration

## 2. Notifications (MVP: Telegram)

- [ ] 2.1 Create notification provider interface (`src/lib/plugins/notifications/types.ts`)
- [ ] 2.2 Implement Telegram provider (`src/lib/plugins/notifications/telegram.ts`)
- [ ] 2.3 Create event handler that dispatches to notification subscriptions

## 3. Telegram Bot Integration

- [ ] 3.1 Implement Telegram Bot with deep link onboarding
  - [ ] 3.1.1 Create bot webhook handler (`src/app/api/telegram/webhook/route.ts`)
  - [ ] 3.1.2 Implement `/start {token}` - validate token, capture chat ID, create subscription
  - [ ] 3.1.3 Implement `/subscriptions` - list user's subscriptions
  - [ ] 3.1.4 Implement `/stop` - unsubscribe
  - [ ] 3.1.5 Implement `/help`
- [ ] 3.2 Set up webhook registration script for bot deployment

## 4. API (tRPC)

- [ ] 4.1 Create tRPC notifications router (`src/trpc/routers/notifications/`)
  - [ ] 4.1.1 `getProviders` procedure
  - [ ] 4.1.2 `initiateTelegramLink` procedure - generate deep link token
  - [ ] 4.1.3 `checkTelegramLinkStatus` procedure - poll if linking completed
  - [ ] 4.1.4 `unsubscribe` procedure
  - [ ] 4.1.5 `list` procedure
  - [ ] 4.1.6 `test` procedure

## 5. UI

- [ ] 5.1 Create notification settings UI (`src/app/groups/[groupId]/notifications/`)
  - [ ] 5.1.1 "Connect Telegram" button with deep link
  - [ ] 5.1.2 Polling UI to detect when linking completes
  - [ ] 5.1.3 Event selection checkboxes
  - [ ] 5.1.4 Connected state with unsubscribe option
- [ ] 5.2 Add settings navigation to group page (notifications tab)

## 6. Reminders

- [ ] 6.1 Implement balance reminder scheduler (cron job or Vercel cron)

## 7. Tests & Docs

- [ ] 7.1 Write unit tests for notification dispatch
- [ ] 7.2 Write unit tests for bot command handlers
- [ ] 7.3 Write E2E tests for subscription management (mocked bot)
- [ ] 7.4 Document Telegram bot setup in README (for self-hosters)

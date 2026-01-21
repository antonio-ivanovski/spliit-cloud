## 1. Core Infrastructure

- [x] 1.1 Create event system (`src/lib/events.ts`) with event bus and handler registration
- [x] 1.2 Integrate event emission into `logActivity()` in `src/lib/api.ts`
- [x] 1.3 Add feature flags to `src/lib/featureFlags.ts` (ENABLE_GROUP_SYNC, ENABLE_NOTIFICATIONS, ENABLE_WEBHOOKS)
- [x] 1.4 Add encryption utility for secrets (`src/lib/crypto.ts`)

## 2. Database Schema

- [x] 2.1 Add `SyncUser` model to Prisma schema
- [x] 2.2 Add `SyncedGroup` model to Prisma schema
- [x] 2.3 Add `SyncSession` model to Prisma schema
- [x] 2.4 Add `MagicLinkToken` model to Prisma schema
- [ ] 2.5 Add `NotificationSubscription` model to Prisma schema
- [ ] 2.6 Add `Webhook` model to Prisma schema
- [ ] 2.7 Create and run database migration

## 3. Sync Authentication

- [x] 3.1 Create auth utilities (`src/lib/auth/`)
  - [x] 3.1.1 Session token generation and validation
  - [x] 3.1.2 Magic link token generation
  - [x] 3.1.3 Email sending utility (nodemailer)
- [x] 3.2 Implement magic link auth routes
  - [x] 3.2.1 `POST /api/auth/magic-link` - Request magic link
  - [x] 3.2.2 `GET /api/auth/magic-link/verify` - Verify and create session
- [x] 3.3 Implement OAuth routes (optional providers)
  - [x] 3.3.1 `GET /api/auth/oauth/google` - Initiate Google OAuth
  - [x] 3.3.2 `GET /api/auth/oauth/google/callback` - Handle callback
  - [x] 3.3.3 `GET /api/auth/oauth/github` - Initiate GitHub OAuth
  - [x] 3.3.4 `GET /api/auth/oauth/github/callback` - Handle callback
- [x] 3.4 Implement session management routes
  - [x] 3.4.1 `POST /api/auth/logout` - Logout current session
  - [x] 3.4.2 `POST /api/auth/logout-all` - Logout all sessions
  - [x] 3.4.3 `DELETE /api/auth/account` - Delete account
- [x] 3.5 Create auth context/hook for client (`src/lib/auth/use-sync-auth.ts`)
- [x] 3.6 Write unit tests for auth utilities
- [ ] 3.7 Write E2E tests for magic link flow

## 4. Group Sync (MVP: Spliit Cloud)

- [x] 4.1 Create sync provider interface (`src/lib/plugins/sync/types.ts`)
- [x] 4.2 Implement Spliit Cloud provider (`src/lib/plugins/sync/spliit-cloud.ts`)
- [x] 4.3 Create tRPC sync router (`src/trpc/routers/sync/`)
  - [x] 4.3.1 `getStatus` procedure - Get sync status and user info
  - [x] 4.3.2 `push` procedure - Upload local groups
  - [x] 4.3.3 `pull` procedure - Download groups
  - [x] 4.3.4 `disconnect` procedure - Logout
- [x] 4.4 Create sync settings UI (`src/app/settings/sync/`)
  - [x] 4.4.1 Auth form (email input, OAuth buttons)
  - [x] 4.4.2 Connected state with sync controls
  - [x] 4.4.3 Account management (logout, delete)
- [x] 4.5 Add sync indicator to groups page header
- [x] 4.6 Integrate sync with recent-groups-helpers.ts
- [x] 4.7 Write unit tests for sync logic
- [ ] 4.8 Write E2E tests for sync flow
- [x] 4.9 Document SMTP setup in README

## 5. Notifications (MVP: Telegram)

- [ ] 5.1 Create notification provider interface (`src/lib/plugins/notifications/types.ts`)
- [ ] 5.2 Implement Telegram provider (`src/lib/plugins/notifications/telegram.ts`)
- [ ] 5.3 Create event handler that dispatches to notification subscriptions
- [ ] 5.4 Implement Telegram Bot with deep link onboarding
  - [ ] 5.4.1 Create bot webhook handler (`src/app/api/telegram/webhook/route.ts`)
  - [ ] 5.4.2 Implement `/start {token}` command - validate token, capture chat ID, create subscription
  - [ ] 5.4.3 Implement `/subscriptions` command - list user's subscriptions
  - [ ] 5.4.4 Implement `/stop` command - unsubscribe
  - [ ] 5.4.5 Implement `/help` command
  - [ ] 5.4.6 Add `TelegramLinkToken` model to Prisma schema
- [ ] 5.5 Create tRPC notifications router (`src/trpc/routers/notifications/`)
  - [ ] 5.5.1 `getProviders` procedure
  - [ ] 5.5.2 `initiateTelegramLink` procedure - generate deep link token
  - [ ] 5.5.3 `checkTelegramLinkStatus` procedure - poll if linking completed
  - [ ] 5.5.4 `unsubscribe` procedure
  - [ ] 5.5.5 `list` procedure
  - [ ] 5.5.6 `test` procedure
- [ ] 5.6 Create notification settings UI (`src/app/groups/[groupId]/notifications/`)
  - [ ] 5.6.1 "Connect Telegram" button with deep link
  - [ ] 5.6.2 Polling UI to detect when linking completes
  - [ ] 5.6.3 Event selection checkboxes
  - [ ] 5.6.4 Connected state with unsubscribe option
- [ ] 5.7 Implement balance reminder scheduler (cron job or Vercel cron)
- [ ] 5.8 Write unit tests for notification dispatch
- [ ] 5.9 Write unit tests for bot command handlers
- [ ] 5.10 Write E2E tests for subscription management (mocked bot)
- [ ] 5.11 Document Telegram bot setup in README (for self-hosters)
- [ ] 5.12 Set up webhook registration script for bot deployment
- [ ] 5.9 Document Telegram bot setup in README

## 6. Webhooks

- [ ] 6.1 Create webhook delivery service (`src/lib/plugins/webhooks/delivery.ts`)
- [ ] 6.2 Implement HMAC signature generation
- [ ] 6.3 Create event handler that dispatches to webhooks
- [ ] 6.4 Implement retry logic with exponential backoff
- [ ] 6.5 Create tRPC webhooks router (`src/trpc/routers/webhooks/`)
  - [ ] 6.5.1 `create` procedure
  - [ ] 6.5.2 `update` procedure
  - [ ] 6.5.3 `delete` procedure
  - [ ] 6.5.4 `list` procedure
  - [ ] 6.5.5 `test` procedure
  - [ ] 6.5.6 `regenerateSecret` procedure
- [ ] 6.6 Create webhook settings UI (`src/app/groups/[groupId]/webhooks/`)
- [ ] 6.7 Write unit tests for signature verification
- [ ] 6.8 Write E2E tests for webhook management
- [ ] 6.9 Document webhook payload format and verification

## 7. Integration & Polish

- [ ] 7.1 Add settings navigation to group page (notifications, webhooks tabs)
- [ ] 7.2 Add Settings link to main navbar with gear icon
- [ ] 7.3 Create unified Settings page at `/settings` consolidating sync settings
- [ ] 7.4 Add i18n messages for all new UI strings
- [x] 7.5 Update environment variable documentation
- [x] 7.6 Add feature flag checks to all new UI components
- [ ] 7.7 Manual QA testing for all flows
- [ ] 7.8 Update AGENTS.md docs with new architecture

## Dependencies

```
1.x Core Infrastructure
 ↓
2.x Database Schema
 ↓
3.x Sync Auth ──────┬──→ 4.x Group Sync
                    │
1.2 Event System ───┼──→ 5.x Notifications
                    │
                    └──→ 6.x Webhooks
                              ↓
                         7.x Integration
```

- Tasks 2.x must complete before 3.x (auth models needed)
- Task 3.x must complete before 4.x (auth required for sync)
- Task 1.2 must complete before 5.3, 6.3 (event system needed for handlers)
- Tasks 4.x, 5.x, 6.x can be parallelized after their dependencies are met
- Phase 7 requires all prior phases complete

## Parallelization Notes

After core infrastructure (1.x), database (2.x), and auth (3.x) complete:

- Group Sync (4.x), Notifications (5.x), and Webhooks (6.x) can be developed in parallel
- Within each module, API work can proceed independently from UI work after tRPC router is defined

## Environment Variables (New)

```env
# Required for sync
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=noreply@spliit.app

# Optional: OAuth providers
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
GITHUB_OAUTH_CLIENT_ID=
GITHUB_OAUTH_CLIENT_SECRET=

# Optional: Notifications
TELEGRAM_BOT_TOKEN=

# Feature flags
NEXT_PUBLIC_ENABLE_GROUP_SYNC=true
NEXT_PUBLIC_ENABLE_NOTIFICATIONS=true
NEXT_PUBLIC_ENABLE_WEBHOOKS=true
```

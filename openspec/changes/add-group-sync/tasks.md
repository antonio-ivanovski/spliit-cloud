## 1. Core Infrastructure (Shared)

- [x] 1.1 Create event system (`src/lib/events.ts`) with event bus and handler registration
- [x] 1.2 Integrate event emission into `logActivity()` in `src/lib/api.ts`
- [x] 1.3 Add feature flags to `src/lib/featureFlags.ts` (ENABLE_GROUP_SYNC, ENABLE_NOTIFICATIONS, ENABLE_WEBHOOKS)

## 2. Database Schema (Sync)

- [x] 2.1 Add `SyncUser` model to Prisma schema
- [x] 2.2 Add `SyncedGroup` model to Prisma schema
- [x] 2.3 Add `SyncSession` model to Prisma schema
- [x] 2.4 Add `MagicLinkToken` model to Prisma schema
- [ ] 2.5 Create and run database migration

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

## 5. Integration & Polish (Sync)

- [x] 5.1 Add Settings link to main navbar with text-only label
- [ ] 5.2 Create unified Settings page at `/settings` consolidating sync settings
- [ ] 5.3 Add i18n messages for all new UI strings
- [x] 5.4 Update environment variable documentation
- [x] 5.5 Add feature flag checks to all new UI components
- [ ] 5.6 Manual QA testing for sync flows

## 6. Local Development / Testing

- [x] 6.1 Add local mail testing service (writes to `.mail/`) and use it instead of SMTP in local testing

# Change: Add Plugin System for Sync, Notifications, and Webhooks

## Why

Currently, Spliit stores joined groups only in browser localStorage, meaning users lose access to their groups when switching devices or clearing browser data. Users also have no way to receive notifications about group activity or integrate Spliit with external systems. This limits usability for power users and teams who need cross-device access and proactive updates.

## What Changes

### New Capabilities

1. **Group Sync** - Sync joined groups across devices via Spliit Cloud

   - MVP: Spliit Cloud with magic link + OAuth authentication
   - Future: Google Drive, Dropbox, other storage providers
   - Global per-user setting (not per-group)
   - Lightweight auth: no passwords, just email or OAuth

2. **Notifications** - Receive alerts for group activity

   - MVP: Telegram bot integration
   - Future: Email, push notifications
   - Events: expense created/updated/deleted, group settings changed, balance reminders
   - Per-group notification subscriptions

3. **Webhooks** - Custom HTTP callbacks for group events
   - User-defined webhook URLs per group
   - Same event types as notifications
   - JSON payload with event details

### Plugin Architecture

Discrete feature modules with internal extensibility:

- Each capability (sync, notifications, webhooks) is a standalone module
- Modules share a common event system hooked into `logActivity()`
- Storage/notification providers are pluggable within each module
- Feature-flagged for opt-in activation

### Authentication (for Sync only)

- **Magic Link**: Passwordless email-based authentication
- **OAuth**: Optional Google/GitHub sign-in
- Auth is scoped to sync feature only; core expense functionality remains unauthenticated
- No user profiles or complex account management

## Impact

- **Affected specs**: New capabilities (no existing specs to modify)
- **Affected code**:
  - `src/lib/api.ts` - Add event emission in `logActivity()`
  - `src/lib/auth/` - New auth utilities for sync
  - `prisma/schema.prisma` - New models for sync users, sessions, webhooks, notification subscriptions
  - `src/app/api/auth/` - New auth routes (magic link, OAuth)
  - `src/app/settings/` - New settings pages for sync
  - `src/app/groups/[groupId]/` - Group settings sections for notifications/webhooks (notifications below local settings)
  - `src/trpc/routers/` - New routers for sync, notifications, webhooks
  - `src/lib/plugins/` - New plugin module implementations
- **Database**: New tables for auth and plugin configuration (non-breaking, additive)
- **Self-hosting**: Additional env vars for SMTP (required for sync), OAuth providers (optional), Telegram bot token

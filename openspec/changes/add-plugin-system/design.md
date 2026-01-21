## Context

Spliit is a privacy-first, no-auth expense splitting app. Groups are accessed via shareable URLs and joined groups are stored client-side in localStorage. This proposal adds three plugin-like capabilities: cross-device sync, notifications, and webhooks.

### Constraints

- No user authentication exists for core expense features; user identity is implicit (device/browser)
- Must remain self-hostable with minimal external dependencies
- Feature flags control opt-in features
- Privacy-first: user data only sent where user explicitly configures

### Stakeholders

- Self-hosters needing cross-device access
- Teams wanting proactive expense alerts
- Developers integrating Spliit with other systems

## Goals / Non-Goals

### Goals

- Enable users to sync joined groups across devices via Spliit Cloud (MVP)
- Provide lightweight authentication (magic link + OAuth) for sync only
- Provide notification channels for group activity events (Telegram MVP)
- Allow custom webhook integrations for automation
- Maintain privacy-first approach: no data sent without explicit user configuration
- Keep modules independent and feature-flagged

### Non-Goals

- Full user account system with profiles/settings
- Real-time sync (eventual consistency is acceptable)
- Mobile push notifications (requires app store deployment)
- Complex plugin marketplace or 3rd-party plugin SDK

## Decisions

### D1: Spliit Cloud Authentication

**Decision**: Use magic link (email) as primary auth, with OAuth (Google/GitHub) as secondary option.

```
User Flow (Magic Link):
1. User enters email → System sends magic link
2. User clicks link → System validates token, creates session
3. Session token stored in localStorage

User Flow (OAuth):
1. User clicks "Continue with Google/GitHub"
2. OAuth redirect → callback with identity
3. System links to existing account (if email matches) or creates new
4. Session token stored in localStorage
```

**Rationale**:

- Magic link is passwordless, no credential management needed
- OAuth provides convenience for users who prefer it
- Email serves as stable user identifier across both methods
- Minimal server-side complexity (no password hashing, reset flows)

**Alternatives considered**:

- Email + Password: Requires password storage, reset flows, more attack surface
- OAuth only: Excludes users who don't want to link Google/GitHub
- Device ID only: Can't sync across devices (the whole point)

### D2: Sync Data Model

**Decision**: Store sync data server-side in PostgreSQL, keyed by user account.

```prisma
model SyncUser {
  id            String    @id
  email         String    @unique
  createdAt     DateTime  @default(now())

  // OAuth identities (optional)
  googleId      String?   @unique
  githubId      String?   @unique

  // Synced data
  syncedGroups  SyncedGroup[]
  sessions      SyncSession[]
}

model SyncedGroup {
  id        String   @id
  userId    String
  user      SyncUser @relation(fields: [userId], references: [id], onDelete: Cascade)
  groupId   String   // Reference to group (not foreign key - group may not exist on this instance)
  groupName String
  addedAt   DateTime @default(now())

  @@unique([userId, groupId])
  @@index([userId])
}

model SyncSession {
  id        String   @id
  userId    String
  user      SyncUser @relation(fields: [userId], references: [id], onDelete: Cascade)
  token     String   @unique
  expiresAt DateTime
  createdAt DateTime @default(now())

  @@index([userId])
  @@index([token])
}

model MagicLinkToken {
  id        String   @id
  email     String
  token     String   @unique
  expiresAt DateTime
  used      Boolean  @default(false)
  createdAt DateTime @default(now())

  @@index([token])
}
```

**Rationale**:

- Server-side storage enables true cross-device sync
- Simple relational model, no external dependencies
- Sessions allow "sign out everywhere" functionality

**Alternatives considered**:

- Client-side only (Google Drive): Requires OAuth setup per user, complex for self-hosters
- External sync service: Adds dependency, privacy concerns

### D3: Sync Provider Extensibility

**Decision**: Spliit Cloud is primary/default; Google Drive and others as future optional providers.

```typescript
interface SyncProvider {
  id: string
  name: string
  isConfigured(): boolean
  connect(ctx: SyncContext): Promise<void>
  disconnect(ctx: SyncContext): Promise<void>
  push(groups: SyncedGroup[]): Promise<void>
  pull(): Promise<SyncedGroup[]>
}

// MVP: SpliitCloudProvider (uses DB directly)
// Future: GoogleDriveProvider, DropboxProvider, etc.
```

**Rationale**:

- Spliit Cloud works out-of-box, no configuration needed
- Provider interface allows future Google Drive, Dropbox, etc.
- Self-hosters can disable Spliit Cloud if they only want local storage

### D4: Event System Architecture

**Decision**: Extend existing `logActivity()` function to emit events to a lightweight event bus that plugins can subscribe to.

```typescript
// src/lib/events.ts
type SpliitEvent = {
  type: ActivityType
  groupId: string
  data: Record<string, unknown>
  timestamp: Date
}

const eventHandlers: Array<(event: SpliitEvent) => Promise<void>> = []

export function registerEventHandler(handler: (typeof eventHandlers)[0]) {
  eventHandlers.push(handler)
}

export async function emitEvent(event: SpliitEvent) {
  await Promise.allSettled(eventHandlers.map((h) => h(event)))
}
```

**Rationale**: Hooks into existing Activity logging without modifying core expense logic. Handlers fail independently.

**Alternatives considered**:

- Database triggers: PostgreSQL-specific, harder to test
- Message queue (Redis): Overkill for MVP, adds infrastructure

### D5: Notification Subscription Model

**Decision**: Store notification subscriptions in database, keyed by group + provider.

```prisma
model NotificationSubscription {
  id         String   @id
  groupId    String
  provider   String   // "telegram", "email"
  config     String   // JSON: { chatId: "123" } or { email: "foo@bar.com" }
  events     String[] // ["CREATE_EXPENSE", "UPDATE_GROUP"]
  createdAt  DateTime @default(now())

  @@index([groupId])
}

model TelegramLinkToken {
  id        String   @id
  groupId   String
  token     String   @unique
  expiresAt DateTime
  used      Boolean  @default(false)
  createdAt DateTime @default(now())

  @@index([token])
}
```

**Rationale**: Per-group subscriptions allow different notifications for different groups. Config is flexible JSON for provider-specific settings.

### D5b: Telegram Deep Link Onboarding

**Decision**: Use Telegram deep links (`t.me/BotName?start=token`) for frictionless user onboarding. No manual chat ID copying required.

```
User Flow:
1. User clicks "Connect Telegram" in Spliit UI
2. System generates time-limited token encoding groupId
3. UI shows button linking to t.me/SpliitBot?start={token}
4. User clicks → Telegram opens → User presses "Start"
5. Bot receives /start {token}, extracts chat ID from message
6. Bot validates token, calls Spliit API to create subscription
7. Bot confirms to user, Spliit UI updates to show connected
```

**Rationale**:

- Zero-friction for end users (just click Start)
- Chat ID captured automatically by bot
- Self-hosters use same flow with their own bot
- Tokens prevent unauthorized subscription creation

**Bot Architecture**:

```
Hosted Spliit:
- Official @SpliitBot hosted by Spliit team
- Receives webhooks at spliit.app/api/telegram/webhook
- TELEGRAM_BOT_TOKEN set in hosted environment

Self-hosted:
- Self-hoster creates bot via @BotFather
- Sets TELEGRAM_BOT_TOKEN in their env
- Bot webhook points to their instance
```

**Bot Commands**:

- `/start {token}` - Complete subscription linking
- `/subscriptions` - List active subscriptions
- `/stop` - Unsubscribe from all or select groups
- `/help` - Usage instructions

### D6: Webhook Security

**Decision**: Include HMAC signature in webhook headers; secret is per-webhook and stored encrypted.

```
X-Spliit-Signature: sha256=<hmac_hex>
X-Spliit-Timestamp: <unix_timestamp>
```

**Rationale**: Standard webhook security pattern. Prevents spoofing.

**Alternatives considered**:

- No signature: Insecure
- Mutual TLS: Too complex for user-configured webhooks

### D7: Feature Flag Structure

**Decision**: Three independent feature flags:

```env
NEXT_PUBLIC_ENABLE_GROUP_SYNC=true
NEXT_PUBLIC_ENABLE_NOTIFICATIONS=true
NEXT_PUBLIC_ENABLE_WEBHOOKS=true
```

Plus provider-specific config:

```env
# Spliit Cloud auth (required for sync)
SMTP_HOST=...
SMTP_PORT=...
SMTP_USER=...
SMTP_PASSWORD=...
SMTP_FROM=noreply@spliit.app

# OAuth providers (optional)
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
GITHUB_OAUTH_CLIENT_ID=...
GITHUB_OAUTH_CLIENT_SECRET=...

# Future: External sync providers
GOOGLE_DRIVE_CLIENT_ID=...
GOOGLE_DRIVE_CLIENT_SECRET=...

# Notifications
TELEGRAM_BOT_TOKEN=...
```

**Rationale**: Self-hosters can enable only what they need. Providers without credentials are automatically unavailable.

### D8: Settings Navigation Architecture

**Decision**: Add a global Settings page accessible from the main navbar, consolidating sync settings (and future notifications/webhooks) in one place.

```
Navigation Structure:
┌─────────────────────────────────────────────────────────┐
│ [Logo]                      [Groups] [Settings] [🌐] [🌙]│
└─────────────────────────────────────────────────────────┘

Settings Page Structure:
/settings
├── Group Sync section (when ENABLE_GROUP_SYNC=true)
│   ├── Not connected: Login form (email + OAuth)
│   └── Connected: Sync controls, account management
├── Notifications section (future, when enabled)
└── Webhooks section (future, when enabled)
```

**Rationale**:

- Single Settings page is simpler than separate pages per feature
- Navbar icon provides consistent access from anywhere in app
- Settings link hidden when no features are enabled (no empty state)
- Follows established patterns (locale switcher, theme toggle in navbar)

**UI Implementation**:

- Settings icon in navbar (gear/cog icon)
- Full page at `/settings` (not a modal/drawer) for discoverability
- Sections use Card components for visual grouping
- Feature-flagged sections hidden when flag is false

**Alternatives considered**:

- Dropdown menu: Too cramped for sync login form
- Separate pages per feature: Fragmented UX, harder to discover
- User avatar/menu: No user concept in core app

## Data Model

### New Tables

```prisma
// Sync authentication
model SyncUser {
  id            String        @id
  email         String        @unique
  googleId      String?       @unique
  githubId      String?       @unique
  createdAt     DateTime      @default(now())
  syncedGroups  SyncedGroup[]
  sessions      SyncSession[]
}

model SyncedGroup {
  id        String   @id
  userId    String
  user      SyncUser @relation(fields: [userId], references: [id], onDelete: Cascade)
  groupId   String
  groupName String
  addedAt   DateTime @default(now())

  @@unique([userId, groupId])
  @@index([userId])
}

model SyncSession {
  id        String   @id
  userId    String
  user      SyncUser @relation(fields: [userId], references: [id], onDelete: Cascade)
  token     String   @unique
  expiresAt DateTime
  createdAt DateTime @default(now())

  @@index([userId])
  @@index([token])
}

model MagicLinkToken {
  id        String   @id
  email     String
  token     String   @unique
  expiresAt DateTime
  used      Boolean  @default(false)
  createdAt DateTime @default(now())

  @@index([token])
}

// Notifications
model NotificationSubscription {
  id        String   @id
  groupId   String
  provider  String
  config    String
  events    String[]
  createdAt DateTime @default(now())

  @@index([groupId])
}

// Webhooks
model Webhook {
  id        String   @id
  groupId   String
  url       String
  secret    String
  events    String[]
  enabled   Boolean  @default(true)
  createdAt DateTime @default(now())

  @@index([groupId])
}
```

## API Design

### Sync Authentication

- `POST /api/auth/magic-link` - Request magic link email
- `GET /api/auth/magic-link/verify` - Verify magic link token
- `GET /api/auth/oauth/google` - Initiate Google OAuth
- `GET /api/auth/oauth/google/callback` - Google OAuth callback
- `GET /api/auth/oauth/github` - Initiate GitHub OAuth
- `GET /api/auth/oauth/github/callback` - GitHub OAuth callback
- `POST /api/auth/logout` - Logout current session
- `POST /api/auth/logout-all` - Logout all sessions
- `DELETE /api/auth/account` - Delete account and all synced data

### Sync (tRPC)

- `sync.getStatus` - Get current sync status and user info
- `sync.push` - Upload local groups to Spliit Cloud
- `sync.pull` - Download groups from Spliit Cloud
- `sync.disconnect` - Disconnect (logout) from sync

### Notifications (tRPC)

- `notifications.getProviders` - List available providers
- `notifications.subscribe` - Add subscription for group
- `notifications.unsubscribe` - Remove subscription
- `notifications.list` - Get subscriptions for group
- `notifications.test` - Send test notification

### Webhooks (tRPC)

- `webhooks.create` - Add webhook for group
- `webhooks.update` - Modify webhook
- `webhooks.delete` - Remove webhook
- `webhooks.list` - Get webhooks for group
- `webhooks.test` - Send test payload
- `webhooks.regenerateSecret` - Generate new webhook secret

## Risks / Trade-offs

| Risk                                    | Mitigation                                                 |
| --------------------------------------- | ---------------------------------------------------------- |
| Email delivery reliability              | Use established SMTP service; provide clear error messages |
| OAuth setup complexity for self-hosters | Make OAuth optional; magic link works with just SMTP       |
| Session token security                  | Use secure random tokens, short expiry with refresh        |
| Telegram bot setup friction             | Bot creation is one-time; provide step-by-step guide       |
| Webhook abuse (DDoS vector)             | Rate limit webhook deliveries; require URL validation      |
| Sync conflicts (multi-device)           | Last-write-wins with timestamp; acceptable for MVP         |

## Migration Plan

1. **Phase 1 (MVP)**: Spliit Cloud sync (magic link + OAuth), Telegram notifications, basic webhooks
2. **Phase 2**: Additional notification providers (email), balance reminders
3. **Phase 3**: Additional sync providers (Google Drive, Dropbox)

### Rollback

- All features are additive and feature-flagged
- Disabling flags hides UI; data remains but is unused
- No breaking changes to existing functionality

## Open Questions

1. **Balance reminder frequency**: Daily? Weekly? User-configurable?

   - _Tentative_: Weekly default, user-configurable per subscription

2. **Webhook retry policy**: How many retries on failure?

   - _Tentative_: 3 retries with exponential backoff (1s, 10s, 60s)

3. **Sync conflict resolution UI**: Should we show conflicts to user?

   - _Tentative_: No for MVP; last-write-wins silently

4. **Session token lifetime**: How long before expiry?
   - _Tentative_: 30 days with sliding expiry on activity

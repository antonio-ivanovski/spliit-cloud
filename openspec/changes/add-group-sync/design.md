## Context

Spliit is a privacy-first, no-auth expense splitting app. Groups are accessed via shareable URLs and joined groups are stored client-side in localStorage.

This change adds an opt-in sync feature (Spliit Cloud) with lightweight authentication scoped to sync only.

### Constraints

- No user authentication exists for core expense features; user identity is implicit (device/browser)
- Must remain self-hostable with minimal external dependencies
- Feature flags control opt-in features
- Privacy-first: user data only sent where user explicitly configures
- Local development should work without configuring SMTP

## Goals / Non-Goals

### Goals

- Enable users to sync joined groups across devices via Spliit Cloud (MVP)
- Provide lightweight authentication (magic link + OAuth) for sync only
- Keep sync module feature-flagged and non-invasive to core expense flows
- Provide a simple internal event bus foundation for future event-driven extensions

### Non-Goals

- Full user account system with profiles/settings for core app usage
- Real-time sync (eventual consistency is acceptable)
- A public 3rd-party plugin SDK/marketplace

## Decisions

### D1: Spliit Cloud Authentication

**Decision**: Use magic link (email) as primary auth, with OAuth (Google/GitHub) as secondary option.

Magic link flow:

1. User enters email -> system sends magic link
2. User clicks link -> system validates token, creates session
3. Session token stored in localStorage

OAuth flow:

1. User clicks "Continue with Google/GitHub"
2. OAuth redirect -> callback with identity
3. System links to existing account (if email matches) or creates new
4. Session token stored in localStorage

### D6: Local Mail Testing

**Decision**: Provide a local mail transport for development/testing that writes outgoing emails to a local `.mail/` folder (gitignored), using the same `Mailer` interface as the SMTP implementation.

Rationale: Keeps the project self-hostable while making local testing frictionless when SMTP isn't configured.

### D2: Sync Data Model

**Decision**: Store sync data server-side in PostgreSQL, keyed by a sync user account.

### D3: Sync Provider Extensibility

**Decision**: Spliit Cloud is the MVP provider; future providers (Google Drive, Dropbox) can be added via a provider interface.

### D4: Event System Architecture (Foundation)

**Decision**: Extend existing `logActivity()` to emit events to a lightweight in-process event bus that other modules can subscribe to.

Rationale: Hooks into existing activity logging without modifying core expense logic. Handlers fail independently.

### D5: Feature Flag Structure

**Decision**: Independent feature flags per module:

```env
NEXT_PUBLIC_ENABLE_GROUP_SYNC=true
NEXT_PUBLIC_ENABLE_NOTIFICATIONS=true
NEXT_PUBLIC_ENABLE_WEBHOOKS=true
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

## Risks / Trade-offs

- Email delivery reliability -> Use established SMTP service; provide clear error messages
- OAuth setup complexity for self-hosters -> Make OAuth optional; magic link works with just SMTP
- Sync conflicts across devices -> Last-write-wins; acceptable for MVP

## Open Questions

- Session token lifetime: 30 days with sliding expiry on activity?
- Sync conflict resolution UI: keep silent (LWW) for MVP?

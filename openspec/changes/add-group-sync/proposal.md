# Change: Add Cross-Device Group Sync (Spliit Cloud)

## Why

Spliit stores joined groups only in browser localStorage, so users lose access when switching devices or clearing browser data. Cross-device group sync improves usability without changing the core “no account required to use groups” model.

## What Changes

- Add opt-in group sync backed by Spliit Cloud (PostgreSQL) behind `NEXT_PUBLIC_ENABLE_GROUP_SYNC`
- Add lightweight authentication for sync only (magic link email; optional Google/GitHub OAuth)
- Add sync settings UI (connect/disconnect, push/pull, account management)
- Add a small internal event bus (hooked into `logActivity()`) as a foundation for event-driven extensions (notifications/webhooks)

## Impact

- Affected specs: `group-sync`
- Affected code:
  - `src/lib/events.ts`, `src/lib/api.ts`
  - `src/lib/auth/`, `src/app/api/auth/`
  - `src/trpc/routers/sync/`
  - `src/app/settings/`
  - `prisma/schema.prisma`
- Database: new auth + sync tables (additive)
- Self-hosting: requires SMTP env vars; OAuth env vars optional

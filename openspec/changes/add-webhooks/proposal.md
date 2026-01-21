# Change: Add Group Webhooks

## Why

Users and teams want to integrate Spliit activity into external tools (automation, audit logs, reporting) without requiring a native notification channel.

## What Changes

- Add per-group webhook configurations behind `NEXT_PUBLIC_ENABLE_WEBHOOKS`
- Deliver signed JSON payloads for activity events emitted by the shared event system
- Provide basic retry behavior for transient delivery failures
- Add UI for managing webhooks in group settings

## Impact

- Affected specs: `webhooks`
- Affected code:
  - `src/lib/plugins/webhooks/`
  - `src/trpc/routers/webhooks/`
  - `src/app/groups/[groupId]/webhooks/`
  - `prisma/schema.prisma`
- Database: new webhook tables (additive)
- Security: per-webhook secrets; HMAC signatures on deliveries

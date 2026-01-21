## 0. Dependencies

- [x] 0.1 Event system exists and `logActivity()` emits events (`src/lib/events.ts`, `src/lib/api.ts`)
- [ ] 0.2 Feature flag exists: `NEXT_PUBLIC_ENABLE_WEBHOOKS`
- [ ] 0.3 Encryption utility exists for storing secrets (`src/lib/crypto.ts`)

## 1. Database Schema

- [ ] 1.1 Add `Webhook` model to Prisma schema
- [ ] 1.2 Create and run database migration

## 2. Webhook Delivery

- [ ] 2.1 Create webhook delivery service (`src/lib/plugins/webhooks/delivery.ts`)
- [ ] 2.2 Implement HMAC signature generation
- [ ] 2.3 Create event handler that dispatches to webhooks
- [ ] 2.4 Implement retry logic with exponential backoff

## 3. API (tRPC)

- [ ] 3.1 Create tRPC webhooks router (`src/trpc/routers/webhooks/`)
  - [ ] 3.1.1 `create` procedure
  - [ ] 3.1.2 `update` procedure
  - [ ] 3.1.3 `delete` procedure
  - [ ] 3.1.4 `list` procedure
  - [ ] 3.1.5 `test` procedure
  - [ ] 3.1.6 `regenerateSecret` procedure

## 4. UI

- [ ] 4.1 Create webhook settings UI (`src/app/groups/[groupId]/webhooks/`)
- [ ] 4.2 Add settings navigation to group page (webhooks tab)

## 5. Tests & Docs

- [ ] 5.1 Write unit tests for signature verification
- [ ] 5.2 Write E2E tests for webhook management
- [ ] 5.3 Document webhook payload format and verification

## Context

Webhooks provide an integration mechanism for group activity without coupling to any specific destination (like Telegram). Webhooks are opt-in, per-group, and only sent to user-configured URLs.

## Goals / Non-Goals

### Goals

- Per-group webhook endpoints with event selection
- Signed deliveries (HMAC) so consumers can verify authenticity
- Basic retry behavior for transient failures

### Non-Goals

- A complex workflow engine or marketplace
- Exactly-once delivery guarantees

## Decisions

### D1: Webhook Security

**Decision**: Include HMAC signatures and timestamps in webhook headers; secret is per-webhook and stored encrypted.

Headers:

- `X-Spliit-Signature: sha256=<hmac_hex>`
- `X-Spliit-Timestamp: <unix_timestamp>`

### D2: Retry Policy

**Decision**: Retry up to 3 times for 5xx/timeouts with exponential backoff (1s, 10s, 60s). Do not retry on 4xx (except 429).

## Open Questions

- Should retry counts/backoff be configurable per webhook?

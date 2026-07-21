# Deployment

> Self-hosting guidance is preliminary. The project focus is on the cloud account system and public instance at [spliit.cloud](https://spliit.cloud). These notes will expand as self-hosting matures.

For local development, see [Run locally](../README.md#run-locally) and [Run in a container](../README.md#run-in-a-container) in the README.

## Essentials

The app needs: a web frontend (static SPA), an API service, PostgreSQL, and SMTP for sign-in/invitations. Optional: S3-compatible storage for expense documents and an AI provider for receipt scanning.

Copy `container.env.example` to `container.env`, set the required values (see the inline comments), then `bun start-container`. The API runs at `localhost:3001`; the database is only reachable on the internal Docker network.

## Key settings

- `BETTER_AUTH_SECRET` — generate with `openssl rand -base64 32`
- `BETTER_AUTH_URL` — the public API origin (HTTPS), e.g. `https://api.spliit.example.com`
- `WEB_ORIGINS` — the public web origin
- `SMTP_HOST`, `EMAIL_FROM` — required for magic-link sign-in and invitations
- `PUSH_VAPID_PUBLIC_KEY`, `PUSH_VAPID_PRIVATE_KEY`, `PUSH_VAPID_SUBJECT` —
  required together for Web Push delivery. Generate the key pair with
  `bunx web-push generate-vapid-keys`; expose only the public key to clients.
- `S3_UPLOAD_*` — only if `PUBLIC_ENABLE_EXPENSE_DOCUMENTS=true`
- `AI_PROVIDER` — optional: `openai`, `anthropic`, `openai-compatible`, or `google`; defaults to `openai`
- `AI_API_KEY` — only if `PUBLIC_ENABLE_RECEIPT_EXTRACT=true` or `PUBLIC_ENABLE_CATEGORY_EXTRACT=true`
- `AI_BASE_URL` — optional API root for the selected provider (e.g. `https://openrouter.ai/api/v1`)
- `AI_RECEIPT_MODEL` — optional, defaults to `gpt-5-nano`
- `AI_CATEGORY_MODEL` — optional, defaults to `gpt-5-nano`

The web app is a Vite SPA. Build with `bun run build`, serve `apps/web/dist` from any static host, and set `VITE_API_URL` to your API origin.

## Health checks

- `GET /health/readiness` — API and database are reachable
- `GET /health/liveness` — API process is running

## Hardening

- Keep `db` on a private network; only `api` should be publicly reachable
- Use HTTPS with HSTS on both origins
- Run off-server database backups with a tested restore procedure
- Set up SPF/DKIM/DMARC for `EMAIL_FROM`

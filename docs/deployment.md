# Deployment

> Self-hosting guidance is preliminary. The project focus is on the cloud account system and public instance at [spliit.cloud](https://spliit.cloud). These notes will expand as self-hosting matures.

For local development, see [Run locally](../README.md#run-locally) and [Run in a container](../README.md#run-in-a-container) in the README.

## Essentials

The app needs: a web frontend (static SPA), an API service, PostgreSQL, and SMTP for sign-in/invitations. Optional: S3-compatible storage for expense documents, OpenAI key for receipt scanning.

Copy `container.env.example` to `container.env`, set the required values (see the inline comments), then `bun start-container`. The API runs at `localhost:3001`; the database is only reachable on the internal Docker network.

## Key settings

- `BETTER_AUTH_SECRET` — generate with `openssl rand -base64 32`
- `BETTER_AUTH_URL` — the public API origin (HTTPS), e.g. `https://api.spliit.example.com`
- `WEB_ORIGINS` — the public web origin
- `SMTP_HOST`, `EMAIL_FROM` — required for magic-link sign-in and invitations
- `S3_UPLOAD_*` — only if `PUBLIC_ENABLE_EXPENSE_DOCUMENTS=true`
- `OPENAI_API_KEY` — only if `PUBLIC_ENABLE_RECEIPT_EXTRACT=true` or `PUBLIC_ENABLE_CATEGORY_EXTRACT=true`

The web app is a Vite SPA. Build with `bun run build`, serve `apps/web/dist` from any static host, and set `VITE_API_URL` to your API origin.

## Health checks

- `GET /health/readiness` — API and database are reachable
- `GET /health/liveness` — API process is running

## Hardening

- Keep `db` on a private network; only `api` should be publicly reachable
- Use HTTPS with HSTS on both origins
- Run off-server database backups with a tested restore procedure
- Set up SPF/DKIM/DMARC for `EMAIL_FROM`

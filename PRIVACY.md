# Privacy

Spliit Cloud is a community fork of [Spliit](https://github.com/spliit-app/spliit). This page describes what data the app stores and your options.

> Informational, not legal advice. A formal privacy policy will be added before broader public usage.

## Data we store

- **Account**: email, display name, avatar, auth method, sessions
- **Groups and expenses**: groups, participants (name, color), expenses (title, amount in cents, currency, date, payer, splits, category, notes), uploaded expense documents, activity records
- **Email**: magic-link and invitation emails, driven by SMTP credentials stored server-side

## Optional integrations

- **OpenAI**: when receipt scanning or category extraction is enabled, the image or title is sent to OpenAI
- **S3 storage**: uploaded files are stored in the configured bucket

## What we do not do

- Sell data, run third-party tracking or advertising scripts, collect analytics telemetry (in the current build)

## Hosting (public instance)

- web: Cloudflare Pages | API: Hetzner VPS via Dokploy | DB: PostgreSQL (same VPS)
- backups: Cloudflare R2 | uploads: Cloudflare R2 (separate buckets)
- email: configured SMTP provider

## Your choices

- **Self-host** for full data control
- **Disable optional features** by leaving `PUBLIC_ENABLE_*` off
- **Export** your data (available; exported in the same JSON format used for import)

## Contact

**privacy@spliit.cloud**. For security issues, see [SECURITY.md](./SECURITY.md).

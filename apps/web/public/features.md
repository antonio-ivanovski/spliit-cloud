---
title: Features — Spliit Cloud
description: Every Spliit Cloud feature in one catalog: sign-in, smart splits, the installable app, imports, and an open developer platform.
---

# Features

Last updated: October 8, 2026

Everything you need to split expenses. From sign-in to the open platform: browse the full catalog below.

## Accounts & sync

### Sign in your way

Start in seconds with just a display name — no email required — then secure the account with a passkey, a magic link, a password, or your Google, GitHub, or X account. Every method works for every account type.

### Groups & friends

Real membership follows you across devices, with every edit attributed to its author. Keep a running 1-on-1 ledger with a friend outside any group, let couples settle as one unit, and archive finished groups to view-only instead of deleting them.

### Installable app

Install Spliit Cloud as an app on any device for instant loading and a full-screen experience. Your groups stay readable offline, and new expenses queue locally, syncing on reconnect — broader offline editing is on the roadmap.

### Backups & recovery

Your data lives in a managed PostgreSQL database with rotating backups kept for 30 days on a separate S3 bucket off the production server. Even if something bad happens to prod, recovery is straightforward.

## Everyday expenses

### Expenses & smart splits

Create expenses with categories, receipt attachments, and advanced splits — equal, shares, or percentages. Several people can pay inside one expense, line items split individually, and tax plus tip distribute proportionally into precise per-person shares.

### Fast entry

Save one-tap split templates per group and apply them to any expense in seconds. Do quick arithmetic right in the amount field while entering — no separate calculator app needed.

### Multi-currency & crypto

Split across borders with server-side conversion and live rates — fiat from Frankfurter, crypto from Coinbase — plus exact amount overrides with the implied rate shown.

### AI assistance

Describe expenses by voice, scan receipts, and get suggestions in three stages: instant local dictionary and history checks, then your choice of engine — the super-fast System One decision model (TypeSafe Jev) or a slower LLM with greater accuracy. Both learn from your previous expenses.

## Power tools & batch

### Durable recurring expenses

Real series with intervals, endings, catch-up, retries, and previews of what's coming. Pause, edit, or stop a series explicitly — every generated expense stays editable on its own.

### Import & export

Bring history from Splitwise CSV, bank-statement CSVs with a mapping wizard and duplicate detection, Cospend, or Spliit Cloud bundles. Tricount and Settle Up support is on the roadmap. Take everything back out as CSV, printable PDF reports, or full ZIP archives including documents.

### Bulk categorization

Categorize imported expenses in bulk with a System One decision model such as TypeSafe Jev, using your group's history and reviewed choices as hints. Every suggestion shows its confidence before you apply it.

## Sharing & identity

### Invites & group identity

Bring people in however suits you: a shareable link, an email invitation, or a multi-use QR session with scan-to-join on mobile. Give each group its own emoji, colors, and member list.

### Activity & history

Follow every group with a For-you timeline, per-expense history and comments, filtering, sorting, and archived-group search.

### Notifications

Get group and expense updates by email or push, with per-user category preferences so everyone chooses their own signal level.

### 30 languages

The full product in 30 locales, each with its own translation guide. Everyone splits in the language they're comfortable with.

## Insights & budgets

### Balances & settlements

Always see who owes whom with clear payment direction, then settle in one tap — including combined payments. Couples and family units can settle as one entity, so shared households stay simple.

### Stats, charts & budgets

Understand spending with charts, monthly category visuals, and a cross-group roll-up. Set budgets per group and get over-budget alerts before small leaks become big ones.

## Developers & notifications

### API, MCP & OAuth

OpenAPI plus Scalar docs, MCP assistant, and delegated OAuth 2.1 scopes.

### Webhooks

Signed outbound events with delivery retries, so your systems stay in sync with every change.

### Open source

The full codebase is open for audit and contributions, with a self-host option for private instances.

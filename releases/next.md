Welcome to `vNEXT`! The flagship of this release is outbound webhooks — Spliit can now push expense changes to your own integrations in real time — plus a round of smaller polish fixes.

## Highlights

- Outbound webhooks: real-time expense events for your own integrations

### Outbound webhooks: real-time expense events for your own integrations

Spliit no longer ends at the screen: point it at any HTTPS endpoint you own and every expense creation, update, and deletion arrives as a signed event, seconds after it happens. Build the automations you've been missing — a bot that announces new expenses to your group chat, a dashboard that tracks spending live, a sync job that mirrors expenses into your accounting tool.

Each event is signed so you can verify it really came from your instance, deliveries retry automatically with backoff, and everything is manageable from account settings: per-endpoint event selection, delivery history with manual redelivery, test sends, and secret rotation. Full setup, event reference, and signature verification are documented in [docs/webhooks.md](https://github.com/antonio-ivanovski/spliit-cloud/blob/vNEXT/docs/webhooks.md). Events even carry a personal `viewer` block — what you paid, what you owe, and your net on each expense — and endpoints can opt into hearing only about expenses you're personally involved in, so noisy group feeds stay quiet.

This one was requested by the community — thanks to @obsilover for proposing it in #98.

**Manage endpoints in account settings**

<img src="./assets/next/webhook-settings.webp" alt="Webhooks section in account settings with an enabled endpoint and its subscribed events" width="700">

**Create an endpoint with per-event selection**

<img src="./assets/next/webhook-create.webp" alt="Create webhook dialog with name, endpoint URL, enabled toggle, event selection, and involved-only filter" width="480">

**Test the feature on [webhook.site](https://webhook.site)**

<img src="./assets/next/webhook-site-test.webp" alt="Signed Spliit event arriving at webhook.site, showing the signature headers and JSON payload" width="700">

## What's Changed

### 🚀 Features

- Added outbound webhooks: subscribe any HTTPS endpoint to expense created/updated/deleted events, with signed payloads, a personal `viewer` block, involved-only filtering, automatic retries, delivery history with manual redelivery, test sends, secret rotation, and a Create/Edit/View setup dialog with delete confirmation (`TBD` by @TBD)
- Prepared the web app manifest for future store packaging: app shortcuts (create group, all expenses, account settings), install screenshots, and Digital Asset Links groundwork (`TBD` by @TBD)

### 🐛 Bug fixes

- Fixed the install dialog's split-button layout and shortened its copy (`TBD` by @TBD)
- Never show the install promotion inside the already-installed app, whatever display mode it launched in (`TBD` by @TBD)
- Fixed toasts rendering inline below the footer; they now float at the top (centered on mobile, top-right on desktop) (`TBD` by @TBD)

**Full Changelog**: TBD

---
id: spliit-cloud-2-5-0
date: 2026-10-05
title: Spliit Cloud 2.5.0 is here
inApp: true
email: true
---

Spliit Cloud 2.5.0 is out. Here's what's new in this version, followed by a roundup of recent features you might have missed. We'll only share new features and important announcements this way — not the small patches and fixes that ship all the time.

## Activity tab is now personal

The Activity tab now mirrors the expenses timeline: a For you / All switch hides activity that doesn't involve you behind inline rows, and every expense shows your share on its own Your share: line. Details are in the [v2.5.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.5.0) notes.

## Delete your account, with a 48-hour safety net

Account settings has a new Danger zone with a dedicated review page: see the per-group consequences, choose how your name and remaining balances are handled, then type DELETE to schedule. Your account stays active for 48 hours and you can cancel anytime. Details are in the [v2.5.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.5.0) notes.

## Much faster categorization, plus bulk cleanup from Group Tools

Expenses are now categorized in about 250ms with the Jev decision model instead of around 3s with the LLM, and uncertain guesses appear as one-tap suggestion chips. When a whole group needs tidying, [bulk categorization](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.4.0) reviews suggestions and saves them together from Group Tools. Details are in the [v2.4.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.4.0) and [v2.3.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.3.0) notes.

## Import from almost any bank or card CSV

Bring existing spending with you by uploading a bank statement or card export. The [generic CSV importer](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.0.0) maps columns with a live preview, maps categories, and flags duplicates before anything is written.

## Passkeys for every account, including guests

Sign in with your fingerprint, face, or security key instead of a password. Passkeys work for email, social, and guest accounts, and they pair well with anonymous accounts as a replacement for the recovery link. See the [v2.3.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.3.0) notes.

## Invite a whole room in seconds

Share one scan-only QR code that the whole room can use, valid for 15 minutes with a live list of who joined. Guests can also join from their phone camera or the Scan to join action. See the [v2.1.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.1.0) notes.

## A calmer app that shows what's yours

Timelines now hide expenses and activity that don't involve you behind inline rows, with a For you / All switch. You can also set your own group tab order and hide tabs you don't use, see per-person itemized breakdowns in expense details, and pick times on mobile with large scroll wheels. See the [v2.1.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.1.0) and [v2.4.1](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.4.1) notes.

## Take your data with you

Export a full ZIP round-trip backup of groups and accounts, plus CSV and printable PDF reports. Imports and exports are covered in the [v2.0.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.0.0) notes.

## Make each group recognizable

Give every group its own look with an emoji and color, shown on cards, rails, and ambient backgrounds. See the [v2.2.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.2.0) notes.

## For builders: outbound webhooks

Push expense creations, updates, and deletions to your own HTTPS endpoint as signed events with retries, delivery history, and redelivery. Setup is in the [v2.2.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.2.0) notes.

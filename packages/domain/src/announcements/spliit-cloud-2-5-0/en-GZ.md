---
id: spliit-cloud-2-5-0
date: 2026-10-05
title: Spliit Cloud 2.5.0 just dropped
inApp: true
email: true
---

Spliit Cloud 2.5.0 is live. Here is what is new in this drop, plus a quick catch-up on recent features you might have missed. We will only hit you up this way for new features and big announcements — not the tiny patches and fixes shipping all the time.

## Activity tab finally gets personal

The Activity tab now matches the expenses timeline: a For you / All toggle tucks activity that has nothing to do with you behind inline rows, and every expense gets its own Your share: line with your cut. Details are in the [v2.5.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.5.0) notes.

## Delete your account, with a 48-hour safety net

Account settings has a new Danger zone with a dedicated review page: check what happens in each group, choose how your name and remaining balances are handled, then type delete to schedule deletion. Your account stays active for 48 hours and you can cancel anytime. Details are in the [v2.5.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.5.0) notes.

## Categorization that keeps up, plus bulk cleanup from Group Tools

Expenses now get categorized in about 250ms with the Jev decision model instead of around 3s with the LLM, and low-confidence guesses show up as one-tap suggestion chips. When a whole group needs a glow-up, [bulk categorization](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.4.0) lets you review suggestions and save them together from Group Tools. Details are in the [v2.4.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.4.0) and [v2.3.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.3.0) notes.

## Import from basically any bank or card CSV

Bring your old spending with you by uploading a bank statement or card export. The [generic CSV importer](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.0.0) maps columns with a live preview, maps categories, and flags duplicates before anything gets saved.

## Passkeys for every account, guests included

Sign in with your fingerprint, face, or security key instead of a password. Passkeys work for email, social, and guest accounts, and they pair nicely with anonymous accounts as a replacement for the recovery link. See the [v2.3.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.3.0) notes.

## Invite the whole room in seconds

Share one scan-only QR code the whole room can use, good for 15 minutes with a live list of who joined. Guests can also join from their phone camera or the Scan to join action. See the [v2.1.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.1.0) notes.

## A calmer app that shows your stuff

Timelines now tuck expenses and activity that do not involve you behind inline rows, with a For you / All toggle. You can also set your own group tab order and hide tabs you do not use, see per-person itemized breakdowns in expense details, and pick times on mobile with big scroll wheels. See the [v2.1.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.1.0) and [v2.4.1](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.4.1) notes.

## Take your data with you

Export a full ZIP round-trip backup of groups and accounts, plus CSV and printable PDF reports. Imports and exports are covered in the [v2.0.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.0.0) notes.

## Give every group its own vibe

Give each group its own look with an emoji and color, shown on cards, rails, and ambient backgrounds. See the [v2.2.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.2.0) notes.

## For builders: outbound webhooks

Push expense creations, updates, and deletions to your own HTTPS endpoint as signed events with retries, delivery history, and redelivery. Setup is in the [v2.2.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.2.0) notes.

---
id: spliit-cloud-2-6-0
date: 2026-10-08
title: Spliit Cloud now works offline — help test it
inApp: true
email: true
---

Spliit Cloud 2.6.0 brings read-offline to the app: your groups stay readable without a connection. This is the read-offline foundation — full offline write, including creating expenses, will follow once this stage is solid. Details are in the [v2.6.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.6.0) notes.

## What you can do offline

- Open your groups and browse complete expense history with comments, balances, the member roster, subgroup assignments, split presets, budgets, group settings, and recent activity.
- Lists open instantly from the on-device copy and merge new changes in place when you reconnect, so slow connections feel much faster too.
- Install Spliit Cloud as an app on your device with the new step-by-step guidance.

## What still needs a connection

Creating or editing expenses, files, and older activity beyond the downloaded window still need a connection, and balances warn when they are stale. If something looks off after reconnecting, a refresh pulls the latest state.

## Help iron out the kinks

Offline mode is new and needs real-world testing before write-offline ships, and the client received a heavy refactor to make it possible — so bugs may show up in online mode too. If you notice anything odd, whether offline or online — a list that does not load, a control that stays disabled after reconnecting, or a stale balance that never clears — please [report it](https://github.com/antonio-ivanovski/spliit-cloud/issues/new?template=bug_report.yml) with what you were doing, whether you were offline at the time, and what you expected to happen. Reassurance on one point: nothing changed in how expenses are computed on the server — balances, splits, and settlements are calculated exactly as before. Every report helps nail down the remaining bugs.

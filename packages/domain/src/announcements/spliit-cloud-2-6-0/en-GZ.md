---
id: spliit-cloud-2-6-0
date: 2026-10-08
title: Spliit Cloud finally works offline — help us test it
inApp: true
email: true
---

Spliit Cloud 2.6.0 brings read-offline to the app: your groups stay readable with no connection. This is the read-offline foundation — full offline write, including creating expenses, drops once this stage is solid. Details are in the [v2.6.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.6.0) notes.

## What you can do offline

- Open your groups and scroll the full expense history with comments, balances, the member list, subgroup assignments, split presets, budgets, group settings, and recent activity.
- Lists open instantly from the on-device copy and merge new changes in place when you reconnect, so slow connections feel way faster too.
- Install Spliit Cloud as an app on your device with the new step-by-step walkthrough.

## What still needs a connection

Creating or editing expenses, files, and older activity beyond the downloaded window still need a connection, and balances warn when they are stale. If something looks off after reconnecting, a refresh pulls the latest state.

## Help iron out the kinks

Offline mode is brand new and needs real-world testing before write-offline ships, and the client got a heavy refactor to make it happen — so bugs might pop up in online mode too. If you spot anything weird, offline or online — a list that will not load, a button stuck disabled after reconnecting, or a stale balance that never clears — please [report it](https://github.com/antonio-ivanovski/spliit-cloud/issues/new?template=bug_report.yml) with what you were doing, whether you were offline at the time, and what you expected to happen. One reassuring note: nothing changed in how expenses are computed on the server — balances, splits, and settlements are calculated exactly as before. Every report helps squash the remaining bugs.

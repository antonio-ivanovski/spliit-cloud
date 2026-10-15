---
id: spliit-cloud-2-7-0
date: 2026-10-12
title: Receipt scanning is 5× faster — and reads PDFs now
channels: [updates, modal, email]
---

Spliit Cloud 2.7.0 overhauls receipt scanning from top to bottom: scans run about 5× faster, categories come out smarter, and receipts no longer have to be photos. Details are in the [v2.7.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.7.0) notes.

## Faster scans

Receipts now go through a dedicated text-extraction step before any AI looks at them, so a fast model does the structuring work instead of a slow one reading the photo. In our runs, a 10-item receipt dropped from around 80 seconds to about 14, and smaller receipts regularly finish in around 6 seconds. Categorization moved to a fast decision model with your full expense history behind it, so suggestions should land better too.

## More than photos

You can now scan PDF invoices — digital ones read directly, photographed ones fall back automatically — plus TXT, CSV, DOCX, and ODT files. Item quantities also support fractions, so a weighed line like 1.5 kg arrives exactly as printed instead of rounded away.

## You decide when the total doesn't add up

When scanned line items don't sum to the receipt total, the preview now asks which total is correct instead of guessing. Small rounding gaps offer a "Rounding" line with the receipt total preselected; bigger gaps warn you and offer an explicit "Other" line, and you can always fix things in the edit form.

## Tell us what misreads

This new pipeline already handles every scan on Spliit Cloud, so your receipts are the real test suite. If a scan misreads an item, picks a wrong category, or gives you an odd total, please [report it](https://github.com/antonio-ivanovski/spliit-cloud/issues/new?template=bug_report.yml) with the receipt if you can share it.

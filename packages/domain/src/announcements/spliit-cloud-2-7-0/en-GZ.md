---
id: spliit-cloud-2-7-0
date: 2026-10-12
title: receipt scanning is 5× faster now — and it reads PDFs too
channels: [updates, modal, email]
---

Spliit Cloud 2.7.0 totally reworks receipt scanning: scans run about 5× faster, categories land smarter, and receipts don't have to be photos anymore. Details are in the [v2.7.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.7.0) notes.

## Faster scans

Receipts now get a dedicated text-extraction pass before any AI looks at them, so a fast model does the structuring work instead of a slow one squinting at the photo. In our runs, a 10-item receipt dropped from around 80 seconds to about 14, and smaller receipts regularly finish in around 6 seconds. Categorization moved to a fast decision model with your full expense history behind it, so suggestions should land way better too.

## More than photos

You can now scan PDF invoices — digital ones read straight through, photographed ones fall back automatically — plus TXT, CSV, DOCX, and ODT files. Item quantities handle fractions too now, so a weighed line like 1.5 kg shows up exactly as printed instead of getting rounded off.

## You call it when the total looks off

When scanned line items don't add up to the receipt total, the preview now asks you which total is right instead of guessing. Small rounding gaps get a "Rounding" line with the receipt total preselected; bigger gaps flag it and offer a clear "Other" line, and you can always fix things up in the edit form.

## Tell us what misreads

This new pipeline already handles every scan on Spliit Cloud, so your receipts are the real test run. If a scan misreads an item, picks the wrong category, or hands you a weird total, please [report it](https://github.com/antonio-ivanovski/spliit-cloud/issues/new?template=bug_report.yml) with the receipt if you can share it.

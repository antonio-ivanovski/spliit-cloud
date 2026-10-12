Welcome to `vNEXT`! Receipt scanning gets its biggest overhaul yet: faster and cheaper extraction, smarter categorization, more input formats, and a clear choice when the numbers don't add up.

## Highlights

- Faster, cheaper, smarter receipt scanning
- You pick the right total when items don't add up

### Faster, cheaper, smarter receipt scanning

Receipt text is now extracted with a dedicated OCR step before any LLM looks at the receipt. That lets a fast, cheap text-only model do the structuring work instead of running every scan through a slow vision call.

Categorization moves to Jev, the fast decision model introduced for one-off suggestions in `v2.3.0` and bulk categorization in `v2.4.0`. The extraction prompt drops the category list and expense history and focuses purely on reading the receipt; the title, line items, and currency then go through Jev with the full history context for a more accurate pick. The result is a clean separation of concerns: the slow LLM only extracts what is printed, while the fast decision model categorizes.

The choice is modular. Use just the LLM if you don't want to set anything else up, add Jev for the biggest speed win, add OCR for a smaller speed win with more flexibility in LLM model choice, or run OCR + LLM + Jev for the fastest and cheapest scans.

Roughly 5× faster in practice: scans around 80s come down to about 14s, and smaller receipts finish in around 6s. Spliit Cloud already runs this path in production. If a scan misreads something, please [tell us](https://github.com/antonio-ivanovski/spliit-cloud/issues/new?template=bug_report.yml) with the receipt if you can share it.

The extraction prompts were also reworked so the model reports what it actually read: exact integer prices and quantities with no decimal drift, details joined across split lines, confused digits double-checked against printed line totals, blank total instead of a guess when none is visible, and store-wide discount summaries dropped while item-level discounts and deposits are kept.

Scans are no longer photo-only: PDF invoices (digital-text PDFs extract their text directly, scanned-image PDFs fall back to OCR or vision) plus TXT, CSV, DOCX, and ODT files are accepted. Item quantities also support fractions up to 3 decimals (for example `1.5` kg) — tedious to type by hand, but exactly what a weighed produce line needs — so scans now capture the true fractional quantity instead of rounding it away.

### You pick the right total when items don't add up

When scanned line items don't sum to the receipt total, the preview now asks explicitly which total is correct instead of silently adjusting. Rounding-size gaps offer the choice immediately with the receipt total preselected and a "Rounding" line; larger gaps warn they look bigger than rounding and offer an explicit "Other" (or "Other (excess)") line. What counts as rounding follows each currency's real cash settlement (¥1 for yen, 3 fils for Gulf dinars, 51 cents for dollars).

## What's Changed

### 🚨 Breaking Changes

- Item quantities are stored as milli-units: existing quantities migrate automatically (`2` → `2000`), pre-upgrade export backups scale on import, on-device offline caches refresh in place (stored snapshots re-download once), and webhook `quantity` values now read in thousandths (`1500` means 1.5 items — see the webhook docs). An outdated app tab that tries to save is stopped with a refresh prompt instead of writing a wrong quantity. (`TBD` by @TBD)
- AI reasoning effort is now operator-configured and omitted by default: category suggestions previously sent a hardcoded `none` reasoning level and now send no reasoning parameter unless configured, so suggestions may differ slightly where `none` was previously honored. Receipt scans and voice extraction sent no reasoning parameter before and still send none by default. To pin the old category behavior, set `AI_CATEGORY_REASONING=none` (or `AI_REASONING=none` for all three purposes). (`TBD` by @TBD)

### 🚀 Features

- Stats now has a separate Paid card next to Participant shares, so each person's spending share can be compared against what they actually paid. Thanks @Commit25uccess for opening [#156](https://github.com/antonio-ivanovski/spliit-cloud/issues/156). (`TBD` by @TBD)
- Receipt scans can hand categorization off to the Jev decision model: with `AI_CATEGORY_ENGINE=system-one`, the scan prompt acts as pure OCR/extraction and the title plus items go through the usual category suggester. (`TBD` by @TBD)
- Optional dedicated OCR backend for receipt scans: set `AI_OCR_PROVIDER=ocrspace` (plus `AI_OCRSPACE_API_KEY`) to extract receipt text via OCR.space and structure it with a fast text-only model call instead of the vision LLM, with automatic fallback to the vision scan when OCR fails (free OCR.space tier: 1 MB cap, 3 PDF pages). Scans that find nothing now say so explicitly and keep the photo attached for manual entry. (`TBD` by @TBD)
- Scan receipts from PDFs and documents: AI receipt scan now accepts PDF invoices (text-based PDFs read directly, scanned-image PDFs fall back to OCR or vision) plus TXT, CSV, DOCX, and ODT files alongside photos. (`TBD` by @TBD)
- Receipt line items now render as a structured list with line totals: the AI scan preview and saved expenses share the same rows, with a `qty × unit price` sub-line only when the quantity isn't 1 and a show-more toggle for long receipts. (`TBD` by @TBD)
- More reliable receipt line items: exact integer prices and quantities, joined details across adjacent lines, digit-confusion cross-checks against printed line totals, blank total instead of a guess, item-level discounts and deposits kept, and billing periods added to titles like utility bills. (`TBD` by @TBD)
- Fractional item quantities: quantities accept up to 3 decimals (for example `1.5` kg for weighed produce), whole numbers still display and type as whole, and the receipt scanner captures the true fractional quantity when the receipt shows one. (`TBD` by @TBD)
- Clearer receipt total mismatches: when scanned items don't add up to the receipt total, the preview asks which total is correct, with a preselected receipt total and "Rounding" line for rounding-size gaps and an explicit "Other" line plus warning for larger gaps. (`TBD` by @TBD)
- Per-purpose AI configuration: receipt scans, category suggestions, and voice extraction can each use a different provider dialect, endpoint, and key via `AI_{RECEIPT,CATEGORY,VOICE}_PROVIDER`, `AI_{RECEIPT,CATEGORY,VOICE}_BASE_URL`, and `AI_{RECEIPT,CATEGORY,VOICE}_API_KEY` (each falls back to `AI_PROVIDER` / `AI_BASE_URL` / `AI_API_KEY`). The provider must match the endpoint's wire dialect (`openai` speaks Responses, `openai-compatible` speaks Chat Completions, `anthropic` speaks Messages). Reasoning effort is likewise per-purpose via `AI_{RECEIPT,CATEGORY,VOICE}_REASONING` with a shared `AI_REASONING` default. (`TBD` by @TBD)

### ⚙️ New environment variables

Self-hosters only — all optional with safe defaults (see `container.env.example` and the deployment docs):

```.env
# Per-purpose provider overrides, each falls back to AI_PROVIDER / AI_BASE_URL / AI_API_KEY
AI_RECEIPT_PROVIDER= / AI_RECEIPT_BASE_URL= / AI_RECEIPT_API_KEY=
AI_CATEGORY_PROVIDER= / AI_CATEGORY_BASE_URL= / AI_CATEGORY_API_KEY=
AI_VOICE_PROVIDER= / AI_VOICE_BASE_URL= / AI_VOICE_API_KEY=
# Reasoning effort (none|minimal|low|medium|high|xhigh), empty means omitted
AI_REASONING= / AI_RECEIPT_REASONING= / AI_CATEGORY_REASONING= / AI_VOICE_REASONING=
# Dedicated OCR backend (none|ocrspace)
AI_OCR_PROVIDER=none
AI_OCRSPACE_API_KEY=
AI_OCRSPACE_TIMEOUT_SECONDS=30
AI_OCR_REQUIRED=false
# One timing tree per scan/voice request in the API logs
TRACING_ENABLED=false
```

### 🐛 Bug fixes

- Split-by-amount expenses keep manually edited per-person amounts when the total changes, rebalancing only the untouched rows instead of resetting everything to equal shares. Thanks @Commit25uccess for opening [#156](https://github.com/antonio-ivanovski/spliit-cloud/issues/156). (`TBD` by @TBD)
- Expense views no longer show raw participant IDs when a name can't be resolved, showing "Unknown member" instead. Thanks @Commit25uccess for opening [#156](https://github.com/antonio-ivanovski/spliit-cloud/issues/156). (`TBD` by @TBD)
- Headings no longer break on Cyrillic group names: the rounded headline font is now self-hosted with Cyrillic, Cyrillic-ext, Latin-ext, and Vietnamese coverage instead of Latin-only system fallbacks. (`TBD` by @TBD)
- Fixed AI receipt scans and expense-document uploads failing with `CORS Missing Allow Origin`: the local MaxIO bucket now allows all local web origins, and self-hosters get documented S3 CORS requirements. (`TBD` by @TBD)
- Fixed a single failing request (for example an AI receipt scan error) wrongly triggering the "Spliit Cloud can't be reached" downtime banner: the banner now appears only when the server is actually unreachable or its health check fails, while request errors show inline where they happened. (`TBD` by @TBD)

**Full Changelog**: TBD

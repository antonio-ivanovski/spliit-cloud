# Batch categorization prototype: follow-up work

This file tracks deliberate shortcuts while we validate the Tools experience locally.

- English UI copy only. After the flow settles, translate new keys through `bun i18n plan` and the translation guides, then run `bun i18n check --changes-only`.
- The run stores candidate snapshots, calibration decisions, and suggestions in JSON columns on one row. Split them into paginated suggestion rows before shipping to large groups; the current design rewrites JSON after each chunk.
- The review table is virtualized, but status still reads the full suggestion array into the browser. Add server pagination before shipping to large groups.
- Variable-height rows use measured sizes with content-based estimates while scrolling; tune the estimates against real long titles and translated category names after local UI review.
- The one-page review component is intentionally kept together while the interaction is changing. Split status cards and review rows into smaller components after the UX settles (React Doctor flags its size and control-flow complexity).
- Calibration uses 12 date-stratified samples, proposed-category agreement and missed-match thresholds, and a four-round cap. Tune these thresholds against real group data; the `examples` column now stores Jev second-pass progress.
- Candidate snapshots use the ledger's currency rather than preserving each expense's original converted input currency. Decide whether review should display original amounts after the interaction settles.
- Jev and local strength bands are derived from their current selection floors, but local scores are heuristic and neither engine's bands are calibrated against reviewed expense outcomes. Tune the floors and bands against labeled group expenses before release.
- Jev requests use batches of five category questions and split further when the service reports a token limit. Benchmark request cost and latency with real groups before choosing final batch sizes.
- Jev's second pass uses a provisional 0.8 confidence floor to assign a category to a General row and queries categorized expenses near each target date. Measure reviewer corrections and query load on real groups, then tune the floor and neighbor retrieval before release.
- Focus verification on type checks and a few direct tests for categorization and job state. Add comprehensive worker retry, concurrency, authorization, and browser interaction coverage before release.
- Starting or editing a run uses a single mutable row. Add atomic status transitions and stale-job protection before concurrent admins can safely work on one group.
- CSV import now reuses the shared Local categorizer for unmatched titles, while its review and mapping rules remain separate. Jev categorization during CSV import and categorization during group import are deferred; the eventual experience should reuse the reviewed Tools workflow, potentially scoped to imported expense IDs.
- The single-expense API and bulk drafts retain their existing response and JSON shapes for compatibility. Once the UI and flow settle, decide whether to expose the typed categorizer evidence directly to both clients and migrate persisted drafts.
- New bulk choices record whether a Jev percentage is primary confidence or an option probability. Older JSON drafts lack this marker and keep their legacy percentage label until rerun; migrate or expire them before release if that distinction must be exact for every active run.

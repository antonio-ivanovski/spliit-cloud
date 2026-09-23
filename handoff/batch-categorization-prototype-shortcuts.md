# Batch categorization follow-ups

The Tools prototype has been moved to per-expense draft rows, bounded 10,000-expense runs, paged review, revision-checked edits, attempt-checked jobs, and one atomic final save. The initial migration creates this storage directly. The review shows ledger-currency amounts, matching the value that will be categorized. Its page-scrolling review now offers General filtering, a read-only expense preview, and sticky actions.

Remaining decisions intentionally outside this Tools production pass:

- Other-locale copy remains deferred by agreement. Add translations with `bun i18n plan`, the translation guides, and `bun i18n check --changes-only` when the localized release is scheduled.
- Categorization during CSV and group import remains separate. CSV import already uses shared Local matching for unmatched titles; a reviewed import integration needs its own flow decision.
- Local match strength is a heuristic band and Jev confidence is model evidence, not measured probability. A read-only sample from one local labeled group gave Local 38 accepted of 47 proposals on 100 expenses and Jev 7 of 9 proposals on 12 expenses. This small sample does not justify changing selection floors, the 12-item calibration size, the four-round cap, Jev's five-question batch size, or its 0.8 second-pass floor. Re-evaluate with more diverse reviewed groups when available; do not present the bands as calibrated probabilities.
- Single-expense API responses retain their compatible shape. Bulk draft rows now store typed evidence for new runs. A future API version can expose the shared engine-neutral result directly if another client needs it.

Verification completed for this pass: a temporary isolated PostgreSQL database applied every migration, captured 10,000 of 10,001 General expenses with date-spread selection, served the final page, and saved 10,000 selected categories while leaving one expense for another run. The temporary database was removed. The user will review the responsive UI in their browser locally.

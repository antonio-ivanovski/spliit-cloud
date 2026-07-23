# Recurring Expenses — Manual Smoke Test Plan

Goal: confirm the recurring-expenses feature works end to end after the new
implementation. This is a smoke test, not full regression — it covers the main
user flows and the highest-risk edge cases. Budget: ~2 hours.

Tick each box as you go. Any failure → stop that section and file/fix it.

---

## 0. Setup

```bash
bun install
bun dev:up          # postgres + maildev + maxio
bun prisma-migrate
bun dev             # web :3000, api :3001
```

Then in the web app:

- [ ] Create (or open) a group with **at least 2 participants** and a currency set.
- [ ] Open the browser devtools Network tab (you'll watch tRPC calls) and keep a
      second tab on the activity feed.

### ⏱️ Read this first — how materialization works

Occurrences are created by a **background job**, not instantly:

- **Future-dated** occurrences materialize ~5 min after midnight UTC of their
  occurrence date. You will **not** see them appear during a short session.
- **Past-dated** creation triggers an immediate **catch-up** that materializes
  all due occurrences at once. **This is the reliable way to observe
  materialization live** — sections B rely on it.
- The **schedule preview** in the expense form is computed client-side, so it is
  always visible and testable regardless of jobs (sections A).

So: use the **preview** to validate date math, and **past-dated creation** to
validate that rows actually get created.

---

## A. Creation & schedule preview (date math)

Create a recurring expense via the expense form. Toggle **Recurring** on.

- [ ] **A1 — Monthly, Never.** Frequency = Monthly, interval 1, end = Never.
      Preview shows 4 upcoming dates, one month apart, same day-of-month.
      Save → expense shows a recurring badge; `createGroupExpense` response
      includes a `recurringSeriesId`.
- [ ] **A2 — Interval > 1.** Every **2 weeks**. Preview dates are 14 days apart.
- [ ] **A3 — Month-end clamp.** Monthly on day **31**. Preview shows Feb as
      28 (or 29 in a leap year), Apr/Jun/Sep/Nov as 30, then back to 31. No
      invalid dates, no overflow into next month.
- [ ] **A4 — After N (COUNT).** End = After **3** occurrences. Preview shows
      exactly 3 entries.
- [ ] **A5 — On date (DATE).** End = On a date ~2.5 months out (monthly). Preview
      stops at/before that date; count matches.
- [ ] **A6 — Yearly leap day.** Yearly on **Feb 29**. Non-leap years show Feb 28,
      leap years show Feb 29.
- [ ] **A7 — Validation.** interval `0` and `100` are rejected; `1` and `99`
      accepted. A DATE end **before** the expense date is rejected.

---

## B. Materialization via catch-up (does it actually create rows?)

This is the core "does it work" check. Create expenses **dated in the past**.

- [ ] **B1 — COUNT catch-up → COMPLETED.** Create a **monthly** recurring expense
      anchored **4 months ago**, end = After **5**. Within seconds, the expense
      list shows multiple materialized occurrences (catch-up). Once 5 exist, the
      series is **COMPLETED** (badge/status reflects terminal state) and no more
      are created.
- [ ] **B2 — Indefinite catch-up stays ACTIVE.** Create a **weekly** recurring
      expense anchored **3 weeks ago**, end = Never. Past due occurrences are
      created; series remains **ACTIVE** with a correct next occurrence date in
      the future.
- [ ] **B3 — Activity feed.** The activity feed shows **recurring expense
      created** entries for the materialized occurrences (distinct from a normal
      "created expense").
- [ ] **B4 — Series progress settles.** Open a series and watch its progress
      indicator: `pending` flips to false once catch-up finishes.
- [ ] **B5 — Amounts & splits copied.** Each materialized occurrence has the same
      title, amount, category, paidBy/paidFor split, and notes as the template.

---

## C. Viewing a series

- [ ] **C1 — Badge.** A recurring expense card shows the recurring badge with the
      correct series status.
- [ ] **C2 — Series list dialog.** Open the series list from an occurrence; it
      lists all occurrences in order and paginates if there are many. Each entry
      links to that occurrence's detail.

---

## D. Editing

Use the recurring actions menu on an occurrence that has both past and future
siblings (use a B1/B2 series).

- [ ] **D1 — Edit this occurrence only.** Change the title/amount of one
      occurrence, scope = **This occurrence only**. Only that row changes; past
      and future siblings are untouched; series template unchanged.
- [ ] **D2 — Edit this & future.** Change the amount, scope = **This and future
      occurrences**. The edited row **and all future** rows update; **past** rows
      keep the old amount.
- [ ] **D3 — Change the recurrence rule.** On a recurring expense, change
      frequency (e.g. Monthly → Weekly) with THIS_AND_FUTURE scope. Series
      template/frequency updates; existing future rows are **re-dated** onto
      the new cadence (or deleted if outside a shortened end); catch-up
      creates any missing due dates through today.

---

## E. Deleting & stopping

- [ ] **E1 — Delete one occurrence.** Delete a single occurrence (scope = This
      occurrence only). Only that row is removed; series stays **ACTIVE**; other
      occurrences intact.
- [ ] **E2 — Delete this & future (keep series).** Delete with scope = This and
      future. The target row and all future rows are removed; past rows remain;
      series stays **ACTIVE**.
- [ ] **E3 — Delete this & future + stop.** Delete with the **and stop
      recurrence** option. Future rows removed **and** series becomes
      **CANCELLED**; activity feed shows a "stopped recurrence" entry.
- [ ] **E4 — Stop recurrence (no delete).** On an ACTIVE series, use **Stop
      recurrence**. Series → **CANCELLED**, but **all existing occurrences are
      preserved**.
- [ ] **E5 — Turn recurrence off.** Edit a recurring expense and untoggle
      Recurring (THIS_AND_FUTURE). The expense detaches and the series is
      cancelled; the expense itself remains as a normal expense.

---

## F. Group archive → pause / resume

- [ ] **F1 — Archive pauses.** Archive the group. Its ACTIVE series become
      **PAUSED** and no new occurrences are produced while archived.
- [ ] **F2 — Unarchive resumes.** Unarchive. Series re-anchors, **skips the
      archived period**, and the next occurrence date is the first correct date
      after unarchiving (no backfill of the archived gap).

---

## G. Optional DB spot-checks

If anything looks off, verify against the DB (`bun prisma studio` or psql):

- [ ] **G1.** `RecurringExpenseSeries` row exists with expected `frequency`,
      `interval`, `endType`, `status`, `nextOccurrenceDate`, `occurrencesCreated`.
- [ ] **G2.** Each `Expense` in a series has `recurringSeriesId` set and a unique,
      monotonic `recurrenceSequence` (anchor = 1).
- [ ] **G3.** After E3/E4/E5, series `status = CANCELLED`; after B1 completion,
      `status = COMPLETED`.

---

## Pass criteria

All boxes in A–F ticked (G is diagnostic). The feature is healthy when:
previews compute correct dates, past-dated catch-up materializes real rows,
edit/delete scopes affect exactly the right rows, and series statuses
(ACTIVE / PAUSED / COMPLETED / CANCELLED) transition as described.

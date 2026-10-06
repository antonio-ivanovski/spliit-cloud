-- Backfill `affectedParticipants` for expense activity rows that predate
-- write-time participant tracking.
--
-- `EXPENSE_CREATED` / `RECURRING_EXPENSE_CREATED` rows historically stored only
-- title/amount/date (see `createExpense` and `materializeOccurrence`), while
-- `EXPENSE_UPDATED` / `EXPENSE_DELETED` already persist the participant union.
-- The activity feed's For-you filtering and per-row viewer share both key off
-- `data.affectedParticipants`, so rows without it can never match the viewer.
--
-- What this backfills: for every expense-kind activity whose subject expense
-- still exists, the union of every ledger participant on the expense's
-- payer/split/item/remainder rows — the same definition as
-- `getAffectedParticipantIds` in
-- `apps/api/src/lib/api/expense-activity-diff/participant-collector.ts`.
--
-- Deliberately NOT touched (the `IS NULL` guard doubles as rerun safety):
--   * rows that already carry `affectedParticipants` (update/delete snapshots
--     include participants since removed — overwriting them with current
--     splits would destroy information);
--   * rows with `data IS NULL` or a non-`expense` kind (nothing to attach to);
--   * activities whose subject expense was deleted (the expense row — and its
--     splits — are cascade-gone, and no snapshot was stored; permanently
--     unknown, the feed treats them as involving everyone);
--   * empty unions (never written: an empty array would read as "known to
--     involve nobody", while here it means "no split rows found").
--
-- Performance note: the per-expense union MUST be built once via the
-- MATERIALIZED CTE below. An inline subquery lets the planner pick a nested
-- loop (it estimates `rows=1` for the JSONB `IS NULL` filter — Postgres keeps
-- no selectivity stats for key existence) and re-scan the aggregate per
-- activity row: ~6 minutes on a 23k-activity copy versus seconds materialized.
--
-- Verification (run before/after on a production-shaped copy):
--   SELECT count(*) FROM "Activity"
--     WHERE "subjectType" = 'EXPENSE' AND data ->> 'kind' = 'expense'
--       AND data -> 'affectedParticipants' IS NULL;
-- Residual missing rows after this migration are exactly the deleted-expense
-- case above.

WITH split AS MATERIALIZED (
  SELECT
    e.id AS expense_id,
    jsonb_agg(DISTINCT u.pid ORDER BY u.pid) AS ids
  FROM "Expense" AS e
  JOIN (
    SELECT "expenseId" AS eid, "ledgerParticipantId" AS pid
      FROM "ExpensePaidBy"
    UNION
    SELECT "expenseId" AS eid, "ledgerParticipantId" AS pid
      FROM "ExpensePaidFor"
    UNION
    SELECT i."expenseId" AS eid, ipf."ledgerParticipantId" AS pid
      FROM "ExpenseItemPaidFor" AS ipf
      JOIN "ExpenseItem" AS i ON i.id = ipf."expenseItemId"
    UNION
    SELECT "expenseId" AS eid, "ledgerParticipantId" AS pid
      FROM "ExpenseItemizedRemainderPaidFor"
  ) AS u ON u.eid = e.id
  GROUP BY e.id
)
UPDATE "Activity" AS a
SET data = a.data || jsonb_build_object('affectedParticipants', split.ids)
FROM split
WHERE a."subjectType" = 'EXPENSE'
  AND a."subjectId" = split.expense_id
  AND a.data IS NOT NULL
  AND a.data ->> 'kind' = 'expense'
  AND a.data -> 'affectedParticipants' IS NULL
  AND split.ids IS NOT NULL
  AND jsonb_array_length(split.ids) > 0;

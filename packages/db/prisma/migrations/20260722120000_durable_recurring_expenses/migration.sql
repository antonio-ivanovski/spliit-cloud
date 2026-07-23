-- Replace the request-time RecurringExpenseLink chain with an explicit,
-- durable series. Keep the backfill, validation, and legacy removal atomic so
-- any invariant failure preserves the old production schema and data.

BEGIN;

CREATE TYPE "RecurrenceFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY');
CREATE TYPE "RecurrenceEndType" AS ENUM ('INDEFINITE', 'COUNT', 'DATE');
CREATE TYPE "RecurringExpenseSeriesStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED');

CREATE TABLE "RecurringExpenseSeries" (
    "id" TEXT NOT NULL,
    "ledgerId" TEXT NOT NULL,
    "creatorAccountId" TEXT,
    "frequency" "RecurrenceFrequency" NOT NULL,
    "interval" INTEGER NOT NULL,
    "anchorDate" DATE NOT NULL,
    "anchorSequence" INTEGER NOT NULL DEFAULT 1,
    "nextOccurrenceDate" DATE NOT NULL,
    "nextOccurrenceOrdinal" INTEGER NOT NULL DEFAULT 2,
    "endType" "RecurrenceEndType" NOT NULL DEFAULT 'INDEFINITE',
    "occurrenceLimit" INTEGER,
    "endDate" DATE,
    "occurrencesCreated" INTEGER NOT NULL DEFAULT 1,
    "status" "RecurringExpenseSeriesStatus" NOT NULL DEFAULT 'ACTIVE',
    "template" JSONB NOT NULL,
    "catchUpBatch" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RecurringExpenseSeries_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Expense"
  ADD COLUMN "recurringSeriesId" TEXT,
  ADD COLUMN "recurrenceSequence" INTEGER;

-- Legacy catch-up often wrote several frames in one millisecond, so
-- nextExpenseCreatedAt alone is not unique. Prefer the candidate whose
-- expenseDate matches the prior link's nextExpenseDate; fall back to a
-- unique createdAt match only when no date-aligned candidate exists.
CREATE TEMP TABLE "_legacy_recurrence_edge_candidates" ON COMMIT DROP AS
SELECT
  l."id" AS "linkId",
  next_expense."id" AS "nextExpenseId",
  n."id" AS "nextLinkId",
  (next_expense."expenseDate" = l."nextExpenseDate"::DATE) AS "dateMatch"
FROM "RecurringExpenseLink" l
JOIN "Expense" next_expense
  ON next_expense."ledgerId" = l."ledgerId"
 AND next_expense."createdAt" = l."nextExpenseCreatedAt"
LEFT JOIN "RecurringExpenseLink" n
  ON n."ledgerId" = l."ledgerId"
 AND n."currentFrameExpenseId" = next_expense."id"
WHERE l."nextExpenseCreatedAt" IS NOT NULL;

CREATE TEMP TABLE "_legacy_recurrence_edges" ON COMMIT DROP AS
WITH date_matched AS (
  SELECT c."linkId", c."nextExpenseId", c."nextLinkId"
  FROM "_legacy_recurrence_edge_candidates" c
  WHERE c."dateMatch"
),
date_matched_links AS (
  SELECT "linkId"
  FROM date_matched
  GROUP BY "linkId"
  HAVING COUNT(*) = 1
),
timestamp_fallback AS (
  SELECT c."linkId", c."nextExpenseId", c."nextLinkId"
  FROM "_legacy_recurrence_edge_candidates" c
  WHERE NOT EXISTS (
    SELECT 1 FROM date_matched_links d WHERE d."linkId" = c."linkId"
  )
),
timestamp_fallback_links AS (
  SELECT "linkId"
  FROM timestamp_fallback
  GROUP BY "linkId"
  HAVING COUNT(*) = 1
)
SELECT d."linkId", d."nextExpenseId", d."nextLinkId"
FROM date_matched d
JOIN date_matched_links ok ON ok."linkId" = d."linkId"
UNION ALL
SELECT t."linkId", t."nextExpenseId", t."nextLinkId"
FROM timestamp_fallback t
JOIN timestamp_fallback_links ok ON ok."linkId" = t."linkId";

DO $$
BEGIN
  -- Still-ambiguous collisions must abort rather than attach an occurrence
  -- to the wrong series.
  IF EXISTS (
    SELECT c."linkId"
    FROM "_legacy_recurrence_edge_candidates" c
    LEFT JOIN "_legacy_recurrence_edges" e ON e."linkId" = c."linkId"
    WHERE e."linkId" IS NULL
    GROUP BY c."linkId"
  ) THEN
    RAISE EXCEPTION 'unable to map every legacy recurring link to one next occurrence';
  END IF;

  IF EXISTS (
    SELECT e."linkId"
    FROM "_legacy_recurrence_edges" e
    GROUP BY e."linkId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'unable to map every legacy recurring link to one next occurrence';
  END IF;
END $$;

CREATE TEMP TABLE "_legacy_recurrence_chain" ON COMMIT DROP AS
WITH RECURSIVE chain("linkId", "rootLinkId", "sequence", "path") AS (
  SELECT
    l."id",
    l."id",
    1,
    ARRAY[l."id"]::TEXT[]
  FROM "RecurringExpenseLink" l
  LEFT JOIN "_legacy_recurrence_edges" e ON e."nextLinkId" = l."id"
  WHERE e."nextLinkId" IS NULL
  UNION ALL
  SELECT
    e."nextLinkId",
    c."rootLinkId",
    c."sequence" + 1,
    c."path" || e."nextLinkId"
  FROM chain c
  JOIN "_legacy_recurrence_edges" e ON e."linkId" = c."linkId"
  WHERE e."nextLinkId" IS NOT NULL
    AND NOT e."nextLinkId" = ANY(c."path")
)
SELECT "linkId", "rootLinkId", "sequence"
FROM chain;

DO $$
BEGIN
  IF (SELECT COUNT(*) FROM "_legacy_recurrence_chain") <>
     (SELECT COUNT(*) FROM "RecurringExpenseLink") THEN
    RAISE EXCEPTION 'legacy recurrence chain validation failed: not every link was assigned';
  END IF;

  IF EXISTS (
    SELECT "rootLinkId"
    FROM "_legacy_recurrence_chain" c
    JOIN "RecurringExpenseLink" l ON l."id" = c."linkId"
    GROUP BY "rootLinkId"
    HAVING COUNT(*) FILTER (WHERE l."nextExpenseCreatedAt" IS NULL) > 1
  ) THEN
    RAISE EXCEPTION 'legacy recurrence chain validation failed: expected one open leaf per series';
  END IF;

  IF EXISTS (
    SELECT l."id"
    FROM "RecurringExpenseLink" l
    LEFT JOIN "_legacy_recurrence_edges" edge
      ON edge."linkId" = l."id" AND edge."nextLinkId" IS NOT NULL
    JOIN "Expense" terminal_expense
      ON terminal_expense."ledgerId" = l."ledgerId"
     AND terminal_expense."createdAt" = l."nextExpenseCreatedAt"
     AND terminal_expense."expenseDate" = l."nextExpenseDate"::DATE
    WHERE l."nextExpenseCreatedAt" IS NOT NULL
      AND edge."linkId" IS NULL
    GROUP BY l."id"
    HAVING COUNT(terminal_expense."id") > 1
  ) THEN
    RAISE EXCEPTION 'legacy recurrence chain validation failed: terminal expense timestamp is ambiguous';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "RecurringExpenseLink" l
    JOIN "Expense" e ON e."id" = l."currentFrameExpenseId"
    WHERE e."recurrenceRule" = 'NONE'
  ) THEN
    RAISE EXCEPTION 'legacy recurrence chain validation failed: link points to a non-recurring expense';
  END IF;
END $$;

CREATE FUNCTION pg_temp._legacy_add_interval(rule TEXT, anchor DATE)
RETURNS DATE
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT CASE rule
    WHEN 'DAILY' THEN (anchor + INTERVAL '1 day')::DATE
    WHEN 'WEEKLY' THEN (anchor + INTERVAL '7 days')::DATE
    WHEN 'MONTHLY' THEN (anchor + INTERVAL '1 month')::DATE
    ELSE (anchor + INTERVAL '1 year')::DATE
  END;
$$;

-- Occurrence 1 is the anchor; occurrence N is a single offset from that anchor
-- (not iterative chaining). Matches domain calculateRecurrenceDate so month-end
-- anchors (31st) stay on the 31st after February clamps.
CREATE FUNCTION pg_temp._legacy_occurrence_date(rule TEXT, anchor DATE, occurrence INTEGER)
RETURNS DATE
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  step INTEGER := occurrence - 1;
BEGIN
  IF occurrence < 1 THEN
    RAISE EXCEPTION 'occurrence must be >= 1';
  END IF;
  RETURN CASE rule
    WHEN 'DAILY' THEN (anchor + (step || ' days')::INTERVAL)::DATE
    WHEN 'WEEKLY' THEN (anchor + ((step * 7) || ' days')::INTERVAL)::DATE
    WHEN 'MONTHLY' THEN (anchor + (step || ' months')::INTERVAL)::DATE
    ELSE (anchor + (step || ' years')::INTERVAL)::DATE
  END;
END;
$$;

-- Standalone orphans never had a working link writer; do not catch up their
-- historical backlog. Advance to the first anchored date strictly after today.
CREATE FUNCTION pg_temp._legacy_next_after_today(rule TEXT, anchor DATE)
RETURNS TABLE(next_date DATE, next_ordinal INTEGER)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  ordinal INTEGER := 2;
  d DATE;
BEGIN
  LOOP
    d := pg_temp._legacy_occurrence_date(rule, anchor, ordinal);
    EXIT WHEN d > CURRENT_DATE;
    ordinal := ordinal + 1;
  END LOOP;
  next_date := d;
  next_ordinal := ordinal;
  RETURN NEXT;
END;
$$;

CREATE FUNCTION pg_temp._legacy_recurrence_template(expense_id TEXT)
RETURNS JSONB
LANGUAGE SQL
STABLE
AS $$
  SELECT jsonb_build_object(
    'title', e."title",
    'categoryId', e."categoryId",
    'amount', COALESCE(e."originalAmount", e."amount"),
    'originalAmount', e."originalAmount",
    'originalCurrency', e."originalCurrency",
    'conversionRate', e."conversionRate",
    'conversionSource', e."conversionSource",
    'paidBySplitMode', e."paidBySplitMode",
    'paidByList', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('ledgerParticipantId', p."ledgerParticipantId", 'shares', p."shares"))
      FROM "ExpensePaidBy" p WHERE p."expenseId" = e."id"
    ), '[]'::JSONB),
    'paidFor', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('ledgerParticipantId', p."ledgerParticipantId", 'shares', p."shares"))
      FROM "ExpensePaidFor" p WHERE p."expenseId" = e."id"
    ), '[]'::JSONB),
    'splitMode', e."splitMode",
    'isReimbursement', e."isReimbursement",
    'notes', e."notes",
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'title', i."title", 'unitPrice', i."unitPrice", 'quantity', i."quantity",
        'amount', i."amount", 'splitMode', i."splitMode",
        'paidFor', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('ledgerParticipantId', ip."ledgerParticipantId", 'shares', ip."shares"))
          FROM "ExpenseItemPaidFor" ip WHERE ip."expenseItemId" = i."id"
        ), '[]'::JSONB)
      ))
      FROM "ExpenseItem" i WHERE i."expenseId" = e."id"
    ), '[]'::JSONB),
    'itemizedRemainder', (
      SELECT jsonb_build_object(
        'splitMode', r."splitMode",
        'paidFor', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('ledgerParticipantId', rp."ledgerParticipantId", 'shares', rp."shares"))
          FROM "ExpenseItemizedRemainderPaidFor" rp WHERE rp."expenseId" = r."expenseId"
        ), '[]'::JSONB)
      )
      FROM "ExpenseItemizedRemainder" r WHERE r."expenseId" = e."id"
    )
  )
  FROM "Expense" e
  WHERE e."id" = expense_id;
$$;

-- The open frame is the migration anchor. This preserves the exact next date
-- users already had scheduled even where a prior month was calendar-clamped.
-- CLOSED-without-terminal (deleted latest occurrence) stays schedulable:
-- skip the deleted slot and continue from the following date.
INSERT INTO "RecurringExpenseSeries" (
  "id", "ledgerId", "creatorAccountId", "frequency", "interval",
  "anchorDate", "anchorSequence", "nextOccurrenceDate", "nextOccurrenceOrdinal", "endType", "occurrenceLimit",
  "endDate", "occurrencesCreated", "status", "template", "version", "createdAt", "updatedAt"
)
SELECT
  md5('recurring-series:' || root."id"),
  leaf_expense."ledgerId",
  creator."accountId",
  CASE leaf_expense."recurrenceRule"::TEXT
    WHEN 'DAILY' THEN 'DAILY'::"RecurrenceFrequency"
    WHEN 'WEEKLY' THEN 'WEEKLY'::"RecurrenceFrequency"
    WHEN 'MONTHLY' THEN 'MONTHLY'::"RecurrenceFrequency"
    ELSE 'YEARLY'::"RecurrenceFrequency"
  END,
  1,
  leaf_expense."expenseDate",
  leaf_chain."sequence",
  CASE
    WHEN leaf_link."nextExpenseCreatedAt" IS NOT NULL AND terminal_expense."id" IS NULL
      THEN pg_temp._legacy_add_interval(
        leaf_expense."recurrenceRule"::TEXT,
        leaf_link."nextExpenseDate"::DATE
      )
    ELSE leaf_link."nextExpenseDate"::DATE
  END,
  CASE
    WHEN leaf_link."nextExpenseCreatedAt" IS NOT NULL AND terminal_expense."id" IS NULL
      THEN 3
    ELSE 2
  END,
  'INDEFINITE'::"RecurrenceEndType",
  NULL,
  NULL,
  chain_count."occurrenceCount"
    + CASE WHEN terminal_expense."id" IS NOT NULL THEN 1 ELSE 0 END,
  CASE
    WHEN leaf_link."nextExpenseCreatedAt" IS NOT NULL AND terminal_expense."id" IS NOT NULL
      THEN 'COMPLETED'
    WHEN g."id" IS NULL OR g."archived" THEN 'PAUSED'
    ELSE 'ACTIVE'
  END::"RecurringExpenseSeriesStatus",
  pg_temp._legacy_recurrence_template(leaf_expense."id"),
  1,
  leaf_expense."createdAt",
  CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT "rootLinkId" FROM "_legacy_recurrence_chain"
) roots
JOIN "RecurringExpenseLink" root ON root."id" = roots."rootLinkId"
JOIN "_legacy_recurrence_chain" leaf_chain
  ON leaf_chain."rootLinkId" = roots."rootLinkId"
JOIN "RecurringExpenseLink" leaf_link ON leaf_link."id" = leaf_chain."linkId"
JOIN "Expense" leaf_expense ON leaf_expense."id" = leaf_link."currentFrameExpenseId"
JOIN "Ledger" l ON l."id" = leaf_expense."ledgerId"
LEFT JOIN "Group" g ON g."ledgerId" = l."id"
JOIN (
  SELECT "rootLinkId", COUNT(*)::INTEGER AS "occurrenceCount"
  FROM "_legacy_recurrence_chain"
  GROUP BY "rootLinkId"
) chain_count ON chain_count."rootLinkId" = roots."rootLinkId"
LEFT JOIN "_legacy_recurrence_edges" leaf_edge
  ON leaf_edge."linkId" = leaf_link."id"
 AND leaf_edge."nextLinkId" IS NOT NULL
LEFT JOIN LATERAL (
  SELECT terminal."id"
  FROM "Expense" terminal
  WHERE terminal."ledgerId" = leaf_link."ledgerId"
    AND terminal."createdAt" = leaf_link."nextExpenseCreatedAt"
    AND terminal."expenseDate" = leaf_link."nextExpenseDate"::DATE
  ORDER BY terminal."id"
  LIMIT 1
) terminal_expense ON leaf_link."nextExpenseCreatedAt" IS NOT NULL AND leaf_edge."linkId" IS NULL
LEFT JOIN LATERAL (
  SELECT CASE
    WHEN a."actorType" = 'ACCOUNT' AND account_actor."id" IS NOT NULL
      THEN account_actor."id"
    WHEN a."actorType" = 'LEDGER_PARTICIPANT'
      THEN participant_account."id"
    ELSE NULL
  END AS "accountId"
  FROM "Activity" a
  LEFT JOIN "Account" account_actor ON account_actor."id" = a."actorId"
  LEFT JOIN "LedgerParticipant" participant_actor
    ON participant_actor."id" = a."actorId"
  LEFT JOIN "GroupMember" participant_member
    ON participant_member."id" = participant_actor."groupMemberId"
  LEFT JOIN "Account" participant_account
    ON participant_account."id" = participant_member."accountId"
  WHERE a."subjectType" = 'EXPENSE'
    AND a."subjectId" = root."currentFrameExpenseId"
    AND a."type" IN ('EXPENSE_CREATED', 'CREATE_EXPENSE')
  ORDER BY a."time", a."id"
  LIMIT 1
) creator ON TRUE
WHERE leaf_edge."linkId" IS NULL;

UPDATE "Expense" e
SET
  "recurringSeriesId" = md5('recurring-series:' || c."rootLinkId"),
  "recurrenceSequence" = c."sequence"
FROM "_legacy_recurrence_chain" c
WHERE e."id" = (
  SELECT l."currentFrameExpenseId"
  FROM "RecurringExpenseLink" l
  WHERE l."id" = c."linkId"
);

-- A link can be closed even after the following expense's link was removed.
-- Recover that final expense as the next sequence so history/navigation is not
-- truncated. Prefer expenseDate alignment when createdAt collided.
UPDATE "Expense" terminal
SET
  "recurringSeriesId" = md5('recurring-series:' || c."rootLinkId"),
  "recurrenceSequence" = c."sequence" + 1
FROM "_legacy_recurrence_chain" c
JOIN "RecurringExpenseLink" leaf_link ON leaf_link."id" = c."linkId"
WHERE leaf_link."nextExpenseCreatedAt" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "_legacy_recurrence_edges" edge
    WHERE edge."linkId" = leaf_link."id"
      AND edge."nextLinkId" IS NOT NULL
  )
  AND terminal."ledgerId" = leaf_link."ledgerId"
  AND terminal."createdAt" = leaf_link."nextExpenseCreatedAt"
  AND terminal."expenseDate" = leaf_link."nextExpenseDate"::DATE
  AND terminal."recurringSeriesId" IS NULL;

-- Link-less recurring expenses (imports / pre-link writer) collapse into one
-- series per fingerprint, matching packages/domain planLegacyRecurringImport:
-- title, rule, amount, split, reimbursement, sorted paidBy/paidFor, FX fields.
-- Advance next past today so reconcile does not flood historical catch-up.
CREATE TEMP TABLE "_legacy_orphan_expenses" ON COMMIT DROP AS
SELECT
  e."id",
  e."ledgerId",
  e."title",
  e."recurrenceRule"::TEXT AS "recurrenceRule",
  e."expenseDate",
  e."amount",
  e."createdAt",
  e."splitMode"::TEXT AS "splitMode",
  e."isReimbursement",
  e."originalCurrency",
  e."conversionRate",
  (
    e."title"
    || E'\x1f' || e."recurrenceRule"::TEXT
    || E'\x1f' || e."amount"::TEXT
    || E'\x1f' || e."splitMode"::TEXT
    || E'\x1f' || CASE WHEN e."isReimbursement" THEN '1' ELSE '0' END
    || E'\x1f' || COALESCE((
      SELECT string_agg(
        p."ledgerParticipantId" || ':' || p."shares"::TEXT,
        ','
        ORDER BY p."ledgerParticipantId" || ':' || p."shares"::TEXT
      )
      FROM "ExpensePaidBy" p WHERE p."expenseId" = e."id"
    ), '')
    || E'\x1f' || COALESCE((
      SELECT string_agg(
        p."ledgerParticipantId" || ':' || p."shares"::TEXT,
        ','
        ORDER BY p."ledgerParticipantId" || ':' || p."shares"::TEXT
      )
      FROM "ExpensePaidFor" p WHERE p."expenseId" = e."id"
    ), '')
    || E'\x1f' || COALESCE(e."originalCurrency", '')
    || E'\x1f' || COALESCE(e."conversionRate"::TEXT, '')
  ) AS "fingerprint"
FROM "Expense" e
WHERE e."recurrenceRule" <> 'NONE'
  AND e."recurringSeriesId" IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "RecurringExpenseLink" existing_link
    WHERE existing_link."currentFrameExpenseId" = e."id"
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "_legacy_recurrence_edges" edge
    WHERE edge."nextExpenseId" = e."id"
  );

CREATE TEMP TABLE "_legacy_orphan_membership" ON COMMIT DROP AS
SELECT
  o.*,
  md5(
    'recurring-collapsed:'
    || o."ledgerId"
    || E'\x1f'
    || o."fingerprint"
  ) AS "seriesId",
  ROW_NUMBER() OVER (
    PARTITION BY o."ledgerId", o."fingerprint"
    ORDER BY o."expenseDate", o."id"
  )::INTEGER AS "sequence",
  COUNT(*) OVER (
    PARTITION BY o."ledgerId", o."fingerprint"
  )::INTEGER AS "occurrenceCount"
FROM "_legacy_orphan_expenses" o;

INSERT INTO "RecurringExpenseSeries" (
  "id", "ledgerId", "creatorAccountId", "frequency", "interval",
  "anchorDate", "anchorSequence", "nextOccurrenceDate", "nextOccurrenceOrdinal", "endType", "occurrenceLimit",
  "endDate", "occurrencesCreated", "status", "template", "catchUpBatch", "version", "createdAt", "updatedAt"
)
SELECT
  anchor."seriesId",
  anchor."ledgerId",
  creator."accountId",
  CASE anchor."recurrenceRule"
    WHEN 'DAILY' THEN 'DAILY'::"RecurrenceFrequency"
    WHEN 'WEEKLY' THEN 'WEEKLY'::"RecurrenceFrequency"
    WHEN 'MONTHLY' THEN 'MONTHLY'::"RecurrenceFrequency"
    ELSE 'YEARLY'::"RecurrenceFrequency"
  END,
  1,
  anchor."expenseDate",
  anchor."sequence",
  schedule.next_date,
  schedule.next_ordinal,
  'INDEFINITE'::"RecurrenceEndType",
  NULL,
  NULL,
  anchor."occurrenceCount",
  CASE
    WHEN g."id" IS NULL OR g."archived" THEN 'PAUSED'
    ELSE 'ACTIVE'
  END::"RecurringExpenseSeriesStatus",
  pg_temp._legacy_recurrence_template(anchor."id"),
  NULL,
  1,
  anchor."createdAt",
  CURRENT_TIMESTAMP
FROM "_legacy_orphan_membership" anchor
JOIN "Ledger" l ON l."id" = anchor."ledgerId"
LEFT JOIN "Group" g ON g."ledgerId" = l."id"
JOIN LATERAL pg_temp._legacy_next_after_today(
  anchor."recurrenceRule",
  anchor."expenseDate"
) schedule ON TRUE
LEFT JOIN LATERAL (
  SELECT CASE
    WHEN a."actorType" = 'ACCOUNT' AND account_actor."id" IS NOT NULL
      THEN account_actor."id"
    WHEN a."actorType" = 'LEDGER_PARTICIPANT'
      THEN participant_account."id"
    ELSE NULL
  END AS "accountId"
  FROM "Activity" a
  LEFT JOIN "Account" account_actor ON account_actor."id" = a."actorId"
  LEFT JOIN "LedgerParticipant" participant_actor ON participant_actor."id" = a."actorId"
  LEFT JOIN "GroupMember" participant_member ON participant_member."id" = participant_actor."groupMemberId"
  LEFT JOIN "Account" participant_account ON participant_account."id" = participant_member."accountId"
  WHERE a."subjectType" = 'EXPENSE'
    AND a."subjectId" = anchor."id"
    AND a."type" IN ('EXPENSE_CREATED', 'CREATE_EXPENSE')
  ORDER BY a."time", a."id"
  LIMIT 1
) creator ON TRUE
WHERE anchor."sequence" = anchor."occurrenceCount";

-- Chain frames already have series ids from the INSERT above; only orphans
-- remain unassigned here.
UPDATE "Expense" e
SET
  "recurringSeriesId" = m."seriesId",
  "recurrenceSequence" = m."sequence"
FROM "_legacy_orphan_membership" m
WHERE e."id" = m."id"
  AND e."recurringSeriesId" IS NULL;


DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "RecurringExpenseLink" l
    LEFT JOIN "_legacy_recurrence_chain" c ON c."linkId" = l."id"
    WHERE c."linkId" IS NULL
  ) THEN
    RAISE EXCEPTION 'legacy recurrence migration validation failed after backfill';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "Expense"
    WHERE "recurrenceRule" <> 'NONE' AND "recurringSeriesId" IS NULL
  ) THEN
    RAISE EXCEPTION 'legacy recurrence migration left a recurring expense unassigned';
  END IF;

  -- ACTIVE schedules must be materializable: stored next date must equal the
  -- anchored ordinal math the worker will validate.
  IF EXISTS (
    SELECT 1
    FROM "RecurringExpenseSeries" s
    JOIN "Expense" leaf
      ON leaf."recurringSeriesId" = s."id"
     AND leaf."recurrenceSequence" = s."anchorSequence"
    WHERE s."status" = 'ACTIVE'
      AND s."nextOccurrenceDate" IS DISTINCT FROM pg_temp._legacy_occurrence_date(
        s."frequency"::TEXT,
        s."anchorDate",
        s."nextOccurrenceOrdinal"
      )
  ) THEN
    RAISE EXCEPTION 'legacy recurrence migration left an ACTIVE series with inconsistent nextOccurrenceDate';
  END IF;
END $$;

ALTER TABLE "RecurringExpenseSeries"
  ADD CONSTRAINT "RecurringExpenseSeries_ledgerId_fkey"
  FOREIGN KEY ("ledgerId") REFERENCES "Ledger"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "RecurringExpenseSeries_creatorAccountId_fkey"
  FOREIGN KEY ("creatorAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "RecurringExpenseSeries_interval_check"
  CHECK ("interval" BETWEEN 1 AND 99),
  ADD CONSTRAINT "RecurringExpenseSeries_anchorSequence_check"
  CHECK ("anchorSequence" >= 1),
  ADD CONSTRAINT "RecurringExpenseSeries_nextOccurrenceOrdinal_check"
  CHECK ("nextOccurrenceOrdinal" >= 1),
  ADD CONSTRAINT "RecurringExpenseSeries_version_check"
  CHECK ("version" >= 1),
  ADD CONSTRAINT "RecurringExpenseSeries_end_check"
  CHECK (
    ("endType" = 'INDEFINITE' AND "occurrenceLimit" IS NULL AND "endDate" IS NULL)
    OR ("endType" = 'COUNT' AND "occurrenceLimit" IS NOT NULL AND "occurrenceLimit" >= 1 AND "endDate" IS NULL)
    OR ("endType" = 'DATE' AND "endDate" IS NOT NULL AND "occurrenceLimit" IS NULL)
  );

ALTER TABLE "Expense"
  ADD CONSTRAINT "Expense_recurringSeriesId_fkey"
  FOREIGN KEY ("recurringSeriesId") REFERENCES "RecurringExpenseSeries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Expense"
  ADD CONSTRAINT "Expense_recurrence_pair_check"
  CHECK (
    ("recurringSeriesId" IS NULL AND "recurrenceSequence" IS NULL)
    OR ("recurringSeriesId" IS NOT NULL AND "recurrenceSequence" IS NOT NULL AND "recurrenceSequence" >= 1)
  );

CREATE INDEX "RecurringExpenseSeries_ledgerId_status_nextOccurrenceDate_idx"
  ON "RecurringExpenseSeries"("ledgerId", "status", "nextOccurrenceDate");
CREATE INDEX "RecurringExpenseSeries_ledgerId_anchorDate_idx"
  ON "RecurringExpenseSeries"("ledgerId", "anchorDate");
CREATE INDEX "Expense_recurringSeriesId_recurrenceSequence_idx"
  ON "Expense"("recurringSeriesId", "recurrenceSequence");
CREATE UNIQUE INDEX "Expense_recurringSeriesId_recurrenceSequence_key"
  ON "Expense"("recurringSeriesId", "recurrenceSequence");

ALTER TABLE "RecurringExpenseLink" DROP CONSTRAINT IF EXISTS "RecurringExpenseLink_currentFrameExpenseId_fkey";
ALTER TABLE "RecurringExpenseLink" DROP CONSTRAINT IF EXISTS "RecurringExpenseLink_ledgerId_fkey";
DROP TABLE "RecurringExpenseLink";
-- Drop orphan temp tables before DROP TYPE: they retain TEXT casts of the
-- legacy enum but ON COMMIT DROP alone is too late inside this transaction.
DROP TABLE IF EXISTS "_legacy_orphan_membership";
DROP TABLE IF EXISTS "_legacy_orphan_expenses";
ALTER TABLE "Expense" DROP COLUMN "recurrenceRule";
DROP TYPE "RecurrenceRule";

COMMIT;

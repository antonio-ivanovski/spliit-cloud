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
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RecurringExpenseSeries_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Expense"
  ADD COLUMN "recurringSeriesId" TEXT,
  ADD COLUMN "recurrenceSequence" INTEGER;

-- Each legacy link points at the expense represented by that frame. Once a
-- frame was materialized, nextExpenseCreatedAt contains the createdAt of the
-- following frame. Resolve that edge before dropping the legacy timestamps.
CREATE TEMP TABLE "_legacy_recurrence_edges" ON COMMIT DROP AS
SELECT
  l."id" AS "linkId",
  n."id" AS "nextLinkId"
FROM "RecurringExpenseLink" l
LEFT JOIN "Expense" next_expense
  ON next_expense."ledgerId" = l."ledgerId"
 AND next_expense."createdAt" = l."nextExpenseCreatedAt"
LEFT JOIN "RecurringExpenseLink" n
  ON n."ledgerId" = l."ledgerId"
 AND n."currentFrameExpenseId" = next_expense."id"
WHERE l."nextExpenseCreatedAt" IS NOT NULL;

DO $$
BEGIN
  -- A timestamp collision would make chain reconstruction ambiguous. Abort
  -- before any legacy data is removed rather than assigning an occurrence to
  -- the wrong series.
  IF EXISTS (
    SELECT l."id"
    FROM "RecurringExpenseLink" l
    LEFT JOIN "_legacy_recurrence_edges" e ON e."linkId" = l."id"
    WHERE l."nextExpenseCreatedAt" IS NOT NULL
    GROUP BY l."id"
    HAVING COUNT(e."nextLinkId") > 1
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
  WHERE NOT e."nextLinkId" = ANY(c."path")
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
    JOIN "Expense" leaf_expense ON leaf_expense."id" = l."currentFrameExpenseId"
    JOIN "Expense" terminal_expense
      ON terminal_expense."ledgerId" = l."ledgerId"
     AND terminal_expense."createdAt" = l."nextExpenseCreatedAt"
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
  leaf_link."nextExpenseDate"::DATE,
  2,
  'INDEFINITE'::"RecurrenceEndType",
  NULL,
  NULL,
  chain_count."occurrenceCount"
    + CASE WHEN leaf_link."nextExpenseCreatedAt" IS NOT NULL AND terminal_expense."id" IS NOT NULL THEN 1 ELSE 0 END,
  CASE
    WHEN leaf_link."nextExpenseCreatedAt" IS NOT NULL THEN 'COMPLETED'
    WHEN g."archived" THEN 'PAUSED'
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
JOIN "Group" g ON g."ledgerId" = l."id"
JOIN (
  SELECT "rootLinkId", COUNT(*)::INTEGER AS "occurrenceCount"
  FROM "_legacy_recurrence_chain"
  GROUP BY "rootLinkId"
) chain_count ON chain_count."rootLinkId" = roots."rootLinkId"
LEFT JOIN LATERAL (
  SELECT terminal."id"
  FROM "Expense" terminal
  WHERE terminal."ledgerId" = leaf_link."ledgerId"
    AND terminal."createdAt" = leaf_link."nextExpenseCreatedAt"
  ORDER BY terminal."id"
  LIMIT 1
) terminal_expense ON TRUE
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
WHERE NOT EXISTS (
  SELECT 1
  FROM "_legacy_recurrence_edges" terminal_edge
  WHERE terminal_edge."linkId" = leaf_link."id"
  AND terminal_edge."nextLinkId" IS NOT NULL
);

-- Imported/raw recurring expenses may predate the link writer. Preserve each
-- such expense as a standalone series instead of silently dropping its rule.
INSERT INTO "RecurringExpenseSeries" (
  "id", "ledgerId", "creatorAccountId", "frequency", "interval",
  "anchorDate", "anchorSequence", "nextOccurrenceDate", "nextOccurrenceOrdinal", "endType", "occurrenceLimit",
  "endDate", "occurrencesCreated", "status", "template", "version", "createdAt", "updatedAt"
)
SELECT
  md5('recurring-standalone:' || e."id"),
  e."ledgerId",
  creator."accountId",
  CASE e."recurrenceRule"::TEXT
    WHEN 'DAILY' THEN 'DAILY'::"RecurrenceFrequency"
    WHEN 'WEEKLY' THEN 'WEEKLY'::"RecurrenceFrequency"
    WHEN 'MONTHLY' THEN 'MONTHLY'::"RecurrenceFrequency"
    ELSE 'YEARLY'::"RecurrenceFrequency"
  END,
  1,
  e."expenseDate",
  1,
  CASE e."recurrenceRule"::TEXT
    WHEN 'DAILY' THEN (e."expenseDate" + INTERVAL '1 day')::DATE
    WHEN 'WEEKLY' THEN (e."expenseDate" + INTERVAL '7 days')::DATE
    WHEN 'MONTHLY' THEN (e."expenseDate" + INTERVAL '1 month')::DATE
    ELSE (e."expenseDate" + INTERVAL '1 year')::DATE
  END,
  2,
  'INDEFINITE'::"RecurrenceEndType",
  NULL,
  NULL,
  1,
  CASE WHEN g."archived" THEN 'PAUSED' ELSE 'ACTIVE' END::"RecurringExpenseSeriesStatus",
  pg_temp._legacy_recurrence_template(e."id"),
  1,
  e."createdAt",
  CURRENT_TIMESTAMP
FROM "Expense" e
JOIN "Ledger" l ON l."id" = e."ledgerId"
JOIN "Group" g ON g."ledgerId" = l."id"
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
    AND a."subjectId" = e."id"
    AND a."type" IN ('EXPENSE_CREATED', 'CREATE_EXPENSE')
  ORDER BY a."time", a."id"
  LIMIT 1
) creator ON TRUE
WHERE e."recurrenceRule" <> 'NONE'
  AND e."recurringSeriesId" IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "RecurringExpenseLink" existing_link
    WHERE existing_link."currentFrameExpenseId" = e."id"
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "RecurringExpenseLink" closed_link
    WHERE closed_link."ledgerId" = e."ledgerId"
      AND closed_link."nextExpenseCreatedAt" = e."createdAt"
  );

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
-- truncated. The validation above rejects timestamp collisions before this
-- update runs.
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
  AND terminal."createdAt" = leaf_link."nextExpenseCreatedAt";

UPDATE "Expense" e
SET
  "recurringSeriesId" = md5('recurring-standalone:' || e."id"),
  "recurrenceSequence" = 1
WHERE e."recurrenceRule" <> 'NONE'
  AND e."recurringSeriesId" IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "RecurringExpenseLink" closed_link
    WHERE closed_link."ledgerId" = e."ledgerId"
      AND closed_link."nextExpenseCreatedAt" = e."createdAt"
  );

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
ALTER TABLE "Expense" DROP COLUMN "recurrenceRule";
DROP TYPE "RecurrenceRule";

COMMIT;

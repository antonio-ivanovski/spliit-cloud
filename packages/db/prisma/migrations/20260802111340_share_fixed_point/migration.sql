-- Rescale every BY_SHARES `shares` column to fixed-point hundredths
-- (`100 = 1 displayed share`). Only the rows whose owning mode is
-- `BY_SHARES` change — every other mode shares the polymorphic column
-- and must remain untouched.
--
-- Relational targets (×100 where the owning record is BY_SHARES):
--   1. ExpensePaidFor              joined to Expense (splitMode)
--   2. ExpensePaidBy               joined to Expense (paidBySplitMode)
--   3. ExpenseItemPaidFor          joined to ExpenseItem (splitMode)
--   4. ExpenseItemizedRemainderPaidFor joined to ExpenseItemizedRemainder
--   5. AccountGroupDefaultSplitPaidFor joined to AccountGroupDefaultSplit
--
-- JSONB target: RecurringExpenseSeries.template conditionally scales
-- the same arrays when their owning mode is BY_SHARES. Templates are
-- assumed to have the canonical shape written by supported application
-- versions; the transform only touches the four known paths.
--
-- Prisma defaults: ExpensePaidFor.shares and ExpensePaidBy.shares
-- move from 1 to 100 so an inclusion row written after the migration
-- still aligns with the new fixed-point representation.
--
-- Preflight: relational values are cast to BIGINT before ABS so the
-- magnitude check cannot overflow on the most negative INTEGER. Any
-- value above 21,474,836 (floor(2147483647 / 100)) would overflow
-- PostgreSQL `INT` after ×100 and aborts the whole migration.
--
-- Existing safe values above the new 1,000,000-display maximum still
-- migrate (old data is preserved), but the domain layer now caps new
-- writes at MAX_DISPLAY_SHARES = 1,000,000.

BEGIN;

-- ─── Preflight: overflow checks ───────────────────────────────────────────

DO $$
DECLARE
  overflow_target TEXT;
  overflow_example TEXT;
  overflow_templates BIGINT;
BEGIN
  -- One compact relational check across all five targets. Each branch
  -- reports its table and an identifying example for the exception.
  SELECT t.target, t.example
    INTO overflow_target, overflow_example
  FROM (
    SELECT 'ExpensePaidFor' AS target,
           ('expenseId=' || pf."expenseId"::text) AS example
    FROM "ExpensePaidFor" pf
    JOIN "Expense" e ON e."id" = pf."expenseId"
    WHERE e."splitMode" = 'BY_SHARES'
      AND ABS(pf."shares"::BIGINT) > 21474836
    UNION ALL
    SELECT 'ExpensePaidBy',
           ('expenseId=' || pb."expenseId"::text)
    FROM "ExpensePaidBy" pb
    JOIN "Expense" e ON e."id" = pb."expenseId"
    WHERE e."paidBySplitMode" = 'BY_SHARES'
      AND ABS(pb."shares"::BIGINT) > 21474836
    UNION ALL
    SELECT 'ExpenseItemPaidFor',
           ('itemId=' || ipf."expenseItemId"::text)
    FROM "ExpenseItemPaidFor" ipf
    JOIN "ExpenseItem" i ON i."id" = ipf."expenseItemId"
    WHERE i."splitMode" = 'BY_SHARES'
      AND ABS(ipf."shares"::BIGINT) > 21474836
    UNION ALL
    SELECT 'ExpenseItemizedRemainderPaidFor',
           ('expenseId=' || rpf."expenseId"::text)
    FROM "ExpenseItemizedRemainderPaidFor" rpf
    JOIN "ExpenseItemizedRemainder" r ON r."expenseId" = rpf."expenseId"
    WHERE r."splitMode" = 'BY_SHARES'
      AND ABS(rpf."shares"::BIGINT) > 21474836
    UNION ALL
    SELECT 'AccountGroupDefaultSplitPaidFor',
           ('defaultSplitId=' || dpf."defaultSplitId"::text)
    FROM "AccountGroupDefaultSplitPaidFor" dpf
    JOIN "AccountGroupDefaultSplit" ds ON ds."id" = dpf."defaultSplitId"
    WHERE ds."splitMode" = 'BY_SHARES'
      AND ABS(dpf."shares"::BIGINT) > 21474836
  ) t
  LIMIT 1;
  IF overflow_target IS NOT NULL THEN
    RAISE EXCEPTION
      'share fixed-point preflight: overflow in % (%); max safe |shares| before ×100 is 21474836',
      overflow_target, overflow_example;
  END IF;

  -- Canonical recurring templates: the same magnitude check on the four
  -- known BY_SHARES JSON paths.
  SELECT COUNT(*) INTO overflow_templates
  FROM "RecurringExpenseSeries" s
  WHERE
    (s."template"->>'paidBySplitMode' = 'BY_SHARES'
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(s."template"->'paidByList') AS row
        WHERE ABS((row->>'shares')::BIGINT) > 21474836
      ))
    OR (s."template"->>'splitMode' = 'BY_SHARES'
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(s."template"->'paidFor') AS row
        WHERE ABS((row->>'shares')::BIGINT) > 21474836
      ))
    OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements(s."template"->'items') AS item
        WHERE item->>'splitMode' = 'BY_SHARES'
          AND EXISTS (
            SELECT 1
            FROM jsonb_array_elements(item->'paidFor') AS row
            WHERE ABS((row->>'shares')::BIGINT) > 21474836
          )
      )
    OR (s."template"->'itemizedRemainder'->>'splitMode' = 'BY_SHARES'
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(s."template"->'itemizedRemainder'->'paidFor') AS row
        WHERE ABS((row->>'shares')::BIGINT) > 21474836
      ));
  IF overflow_templates > 0 THEN
    RAISE EXCEPTION
      'share fixed-point preflight: % RecurringExpenseSeries template(s) contain BY_SHARES weights that would overflow INTEGER after ×100',
      overflow_templates;
  END IF;
END $$;

-- ─── Helper functions for the JSONB template transform ───────────────────

-- Map a JSONB array of `{ledgerParticipantId, shares}` objects so that any
-- numeric `shares` property is multiplied by SHARE_SCALE. The result keeps
-- array order (WITH ORDINALITY + ORDER BY), missing keys, null members, and
-- every other field exactly as the input declared them. Helpers live in
-- pg_temp so they never leak into the application schema.
CREATE FUNCTION pg_temp._scale_share_rows(rows JSONB)
RETURNS JSONB
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT COALESCE(
    jsonb_agg(
      CASE
        WHEN row_value ? 'shares' AND jsonb_typeof(row_value->'shares') = 'number'
          THEN row_value || jsonb_build_object('shares', (row_value->>'shares')::BIGINT * 100)
        ELSE row_value
      END
      ORDER BY row_ordinality
    ),
    '[]'::JSONB
  )
  FROM jsonb_array_elements(rows) WITH ORDINALITY AS row(row_value, row_ordinality);
$$;

-- Reconstruct a single canonical template, scaling only the rows whose
-- owning mode is `BY_SHARES`. Order, missing keys, and unrelated JSON are
-- preserved verbatim so the only diff is the scaled `shares` numbers.
CREATE FUNCTION pg_temp._scale_share_template(template JSONB)
RETURNS JSONB
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT
    template
    || jsonb_build_object(
        'paidByList',
          CASE
            WHEN template->>'paidBySplitMode' = 'BY_SHARES'
              THEN pg_temp._scale_share_rows(COALESCE(template->'paidByList', '[]'::JSONB))
            ELSE template->'paidByList'
          END,
        'paidFor',
          CASE
            WHEN template->>'splitMode' = 'BY_SHARES'
              THEN pg_temp._scale_share_rows(COALESCE(template->'paidFor', '[]'::JSONB))
            ELSE template->'paidFor'
          END,
        'items',
          COALESCE((
            SELECT jsonb_agg(
              CASE
                WHEN item_value->>'splitMode' = 'BY_SHARES'
                  THEN item_value || jsonb_build_object(
                    'paidFor', pg_temp._scale_share_rows(COALESCE(item_value->'paidFor', '[]'::JSONB))
                  )
                ELSE item_value
              END
              ORDER BY item_ordinality
            )
            FROM jsonb_array_elements(COALESCE(template->'items', '[]'::JSONB))
              WITH ORDINALITY AS item(item_value, item_ordinality)
          ), '[]'::JSONB),
        'itemizedRemainder',
          CASE
            WHEN template->'itemizedRemainder' IS NULL
              THEN NULL
            WHEN template->'itemizedRemainder'->>'splitMode' = 'BY_SHARES'
              THEN (template->'itemizedRemainder')
                || jsonb_build_object(
                  'paidFor', pg_temp._scale_share_rows(
                    COALESCE(template->'itemizedRemainder'->'paidFor', '[]'::JSONB)
                  )
                )
            ELSE template->'itemizedRemainder'
          END
      );
$$;

-- ─── Relational updates: ×100 where owning mode is BY_SHARES ─────────────

-- 1. ExpensePaidFor (paidFor splitMode = BY_SHARES)
UPDATE "ExpensePaidFor" pf
SET "shares" = pf."shares" * 100
FROM "Expense" e
WHERE e."id" = pf."expenseId"
  AND e."splitMode" = 'BY_SHARES';

-- 2. ExpensePaidBy (paidBySplitMode = BY_SHARES)
UPDATE "ExpensePaidBy" pb
SET "shares" = pb."shares" * 100
FROM "Expense" e
WHERE e."id" = pb."expenseId"
  AND e."paidBySplitMode" = 'BY_SHARES';

-- 3. ExpenseItemPaidFor (ExpenseItem splitMode = BY_SHARES)
UPDATE "ExpenseItemPaidFor" ipf
SET "shares" = ipf."shares" * 100
FROM "ExpenseItem" i
WHERE i."id" = ipf."expenseItemId"
  AND i."splitMode" = 'BY_SHARES';

-- 4. ExpenseItemizedRemainderPaidFor (remainder splitMode = BY_SHARES)
UPDATE "ExpenseItemizedRemainderPaidFor" rpf
SET "shares" = rpf."shares" * 100
FROM "ExpenseItemizedRemainder" r
WHERE r."expenseId" = rpf."expenseId"
  AND r."splitMode" = 'BY_SHARES';

-- 5. AccountGroupDefaultSplitPaidFor (defaultSplitMode = BY_SHARES)
UPDATE "AccountGroupDefaultSplitPaidFor" dpf
SET "shares" = dpf."shares" * 100
FROM "AccountGroupDefaultSplit" ds
WHERE ds."id" = dpf."defaultSplitId"
  AND ds."splitMode" = 'BY_SHARES';

-- ─── Recurring template JSONB updates (only templates with at least one BY_SHARES path) ─

UPDATE "RecurringExpenseSeries" s
SET "template" = pg_temp._scale_share_template(s."template")
WHERE
    s."template"->>'paidBySplitMode' = 'BY_SHARES'
  OR s."template"->>'splitMode' = 'BY_SHARES'
  OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(s."template"->'items', '[]'::JSONB)) AS item
      WHERE item->>'splitMode' = 'BY_SHARES'
    )
  OR (s."template"->'itemizedRemainder' IS NOT NULL
      AND s."template"->'itemizedRemainder'->>'splitMode' = 'BY_SHARES');

-- ─── Prisma defaults: align the column default with the new representation ─

ALTER TABLE "ExpensePaidFor"
  ALTER COLUMN "shares" SET DEFAULT 100;

ALTER TABLE "ExpensePaidBy"
  ALTER COLUMN "shares" SET DEFAULT 100;

-- pg_temp helpers are automatically dropped at COMMIT.

COMMIT;

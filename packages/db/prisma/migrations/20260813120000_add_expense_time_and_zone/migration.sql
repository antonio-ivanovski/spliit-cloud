-- Backfill-safe: add the selected wall-clock timezone, then promote the
-- historical calendar-only date to the canonical expense instant.
ALTER TABLE "Expense" ADD COLUMN "expenseTimeZone" TEXT NOT NULL DEFAULT 'UTC';
ALTER TABLE "RecurringExpenseSeries" ADD COLUMN "anchorTimeMinutes" INTEGER NOT NULL DEFAULT 900;

-- Legacy one-off expenses have no historical time. Noon UTC preserves their
-- calendar date in almost every timezone and avoids implying midnight.
ALTER TABLE "Expense" ALTER COLUMN "expenseDate" DROP DEFAULT;
ALTER TABLE "Expense"
  ALTER COLUMN "expenseDate" TYPE TIMESTAMPTZ(0)
  USING ("expenseDate"::timestamp + INTERVAL '12 hours') AT TIME ZONE 'UTC';

UPDATE "Expense"
SET "expenseTimeZone" = 'UTC'
WHERE "recurringSeriesId" IS NULL;

-- Recurring expenses historically ran at 15:00 in their series timezone.
-- Align their existing rows with future materializations so a series does not
-- suddenly switch displayed time after this migration.
UPDATE "Expense" AS expense
SET "expenseDate" =
      ((expense."expenseDate" AT TIME ZONE 'UTC')::date + TIME '15:00')
      AT TIME ZONE series."timeZone",
    "expenseTimeZone" = series."timeZone"
FROM "RecurringExpenseSeries" AS series
WHERE expense."recurringSeriesId" = series."id";

ALTER TABLE "RecurringExpenseSeries"
  ADD CONSTRAINT "RecurringExpenseSeries_anchorTimeMinutes_check"
  CHECK ("anchorTimeMinutes" BETWEEN 0 AND 1439);

ALTER TABLE "Expense" ALTER COLUMN "expenseTimeZone" DROP DEFAULT;
ALTER TABLE "RecurringExpenseSeries" ALTER COLUMN "timeZone" DROP DEFAULT;
ALTER TABLE "RecurringExpenseSeries" ALTER COLUMN "anchorTimeMinutes" DROP DEFAULT;

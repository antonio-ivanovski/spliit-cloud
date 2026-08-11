-- Backfill-safe: add columns with defaults, then remove defaults where appropriate
ALTER TABLE "Expense" ADD COLUMN "expenseAt" TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE "Expense" ADD COLUMN "expenseTimeZone" TEXT NOT NULL DEFAULT 'UTC';
ALTER TABLE "RecurringExpenseSeries" ADD COLUMN "anchorTimeMinutes" INTEGER NOT NULL DEFAULT 900;

-- Legacy one-off expenses have no historical time. Noon UTC preserves their
-- calendar date in almost every timezone and avoids implying midnight.
UPDATE "Expense"
SET "expenseAt" = ("expenseDate"::timestamp + INTERVAL '12 hours') AT TIME ZONE 'UTC',
    "expenseTimeZone" = 'UTC';

-- Recurring expenses historically ran at 15:00 in their series timezone.
-- Align their existing rows with future materializations so a series does not
-- suddenly switch displayed time after this migration.
UPDATE "Expense" AS expense
SET "expenseAt" =
      (expense."expenseDate"::timestamp + INTERVAL '15 hours')
      AT TIME ZONE series."timeZone",
    "expenseTimeZone" = series."timeZone"
FROM "RecurringExpenseSeries" AS series
WHERE expense."recurringSeriesId" = series."id";

-- Indexes for new instant field
CREATE INDEX "Expense_ledgerId_expenseAt_idx" ON "Expense"("ledgerId", "expenseAt");

ALTER TABLE "RecurringExpenseSeries"
  ADD CONSTRAINT "RecurringExpenseSeries_anchorTimeMinutes_check"
  CHECK ("anchorTimeMinutes" BETWEEN 0 AND 1439);

ALTER TABLE "Expense" ALTER COLUMN "expenseAt" DROP DEFAULT;
ALTER TABLE "Expense" ALTER COLUMN "expenseTimeZone" DROP DEFAULT;
ALTER TABLE "RecurringExpenseSeries" ALTER COLUMN "anchorTimeMinutes" DROP DEFAULT;

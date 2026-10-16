-- Bulk tools propagate into recurring templates: per-row series membership
-- on BulkCategorizationRow (review grouping + propagation scopes) and an
-- optimistic-concurrency token on RecurringExpenseSeries so concurrent
-- template rewrites fail whole-batch instead of diverging silently.
ALTER TABLE "BulkCategorizationRow" ADD COLUMN "recurringSeriesId" TEXT;
ALTER TABLE "BulkCategorizationRow" ADD COLUMN "recurrenceSequence" INTEGER;
ALTER TABLE "RecurringExpenseSeries" ADD COLUMN "templateVersion" INTEGER NOT NULL DEFAULT 1;

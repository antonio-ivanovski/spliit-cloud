-- Replace single-column ledgerId index with a composite that still
-- serves ledger-scoped lookups (leftmost prefix) and enables efficient
-- expenseDate range filters for common-currency recommendations.
DROP INDEX IF EXISTS "Expense_ledgerId_idx";

CREATE INDEX "Expense_ledgerId_expenseDate_idx" ON "Expense"("ledgerId", "expenseDate");

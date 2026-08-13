-- CreateExtension
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateIndex
CREATE INDEX "Expense_title_trgm_idx" ON "Expense" USING GIN ("title" gin_trgm_ops);

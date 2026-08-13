-- CreateExtension
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateIndex (transactional; Prisma wraps multi-statement migrations)
CREATE INDEX IF NOT EXISTS "Expense_title_trgm_idx" ON "Expense" USING GIN ("title" gin_trgm_ops);

ALTER TABLE "Expense"
ADD COLUMN "createdByAccountId" TEXT;

ALTER TABLE "Expense"
ADD CONSTRAINT "Expense_createdByAccountId_fkey"
FOREIGN KEY ("createdByAccountId") REFERENCES "Account"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Expense_createdByAccountId_idx"
ON "Expense"("createdByAccountId");

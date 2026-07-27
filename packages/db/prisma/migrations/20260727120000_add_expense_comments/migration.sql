-- Expense comments and the activity row associated with each comment.

CREATE TABLE "ExpenseComment" (
    "id" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "authorAccountId" TEXT,
    "authorName" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpenseComment_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Activity" ADD COLUMN "expenseCommentId" TEXT;

CREATE UNIQUE INDEX "Activity_expenseCommentId_key" ON "Activity"("expenseCommentId");
CREATE INDEX "ExpenseComment_expenseId_createdAt_idx" ON "ExpenseComment"("expenseId", "createdAt");
CREATE INDEX "ExpenseComment_authorAccountId_idx" ON "ExpenseComment"("authorAccountId");

ALTER TABLE "ExpenseComment"
  ADD CONSTRAINT "ExpenseComment_expenseId_fkey"
  FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ExpenseComment"
  ADD CONSTRAINT "ExpenseComment_authorAccountId_fkey"
  FOREIGN KEY ("authorAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Activity"
  ADD CONSTRAINT "Activity_expenseCommentId_fkey"
  FOREIGN KEY ("expenseCommentId") REFERENCES "ExpenseComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

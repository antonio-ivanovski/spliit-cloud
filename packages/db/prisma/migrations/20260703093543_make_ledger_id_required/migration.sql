/*
  Warnings:

  - Made the column `ledgerId` on table `ExpenseDocument` required. This step will fail if there are existing NULL values in that column.

*/
-- Delete orphaned documents that have neither a ledger nor an expense link.
-- These were uploaded but never attached to an expense; their S3 temp objects
-- will be purged by the bucket lifecycle rule.
DELETE FROM "ExpenseDocument"
WHERE "ledgerId" IS NULL
  AND "expenseId" IS NULL;

-- Backfill remaining NULL ledgerId values through the Expense relation. This
-- handles documents created before ledgerId was populated on create.
UPDATE "ExpenseDocument"
SET "ledgerId" = "Expense"."ledgerId"
FROM "Expense"
WHERE "ExpenseDocument"."expenseId" = "Expense"."id"
  AND "ExpenseDocument"."ledgerId" IS NULL;

-- DropForeignKey
ALTER TABLE "ExpenseDocument" DROP CONSTRAINT "ExpenseDocument_ledgerId_fkey";

-- AlterTable
ALTER TABLE "ExpenseDocument" ALTER COLUMN "ledgerId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "ExpenseDocument_ledgerId_idx" ON "ExpenseDocument"("ledgerId");

-- AddForeignKey
ALTER TABLE "ExpenseDocument" ADD CONSTRAINT "ExpenseDocument_ledgerId_fkey" FOREIGN KEY ("ledgerId") REFERENCES "Ledger"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

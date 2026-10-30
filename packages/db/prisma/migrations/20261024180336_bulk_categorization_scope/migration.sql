-- Backfill-capable scope migration for bulk categorization.
-- Existing group runs become scopeType='GROUP', scopeId=groupId; existing rows
-- become itemType='EXPENSE', itemId=expenseId. New PERSONAL runs use
-- scopeType='PERSONAL', scopeId=accountId with personalAccountId FK cascade
-- (account deletion deletes personal runs; group runs keep the Group cascade).

-- AlterTable: add scope columns to runs (nullable groupId for personal runs).
ALTER TABLE "BulkCategorizationRun" ADD COLUMN "personalAccountId" TEXT;
ALTER TABLE "BulkCategorizationRun" ADD COLUMN "scopeId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "BulkCategorizationRun" ADD COLUMN "scopeType" TEXT NOT NULL DEFAULT 'GROUP';
ALTER TABLE "BulkCategorizationRun" ALTER COLUMN "groupId" DROP NOT NULL;

-- Backfill existing group runs before the scope unique index is created.
UPDATE "BulkCategorizationRun" SET "scopeType" = 'GROUP', "scopeId" = "groupId" WHERE "groupId" IS NOT NULL AND "scopeId" = '';

-- AlterTable: add generic item columns to rows before dropping expenseId.
ALTER TABLE "BulkCategorizationRow" ADD COLUMN "itemId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "BulkCategorizationRow" ADD COLUMN "itemType" TEXT NOT NULL DEFAULT 'EXPENSE';

-- Backfill existing rows from the legacy expenseId column.
UPDATE "BulkCategorizationRow" SET "itemId" = "expenseId", "itemType" = 'EXPENSE' WHERE "itemId" = '';

-- Swap the primary key from [runId, expenseId] to [runId, itemId].
ALTER TABLE "BulkCategorizationRow" DROP CONSTRAINT "BulkCategorizationRow_pkey";
ALTER TABLE "BulkCategorizationRow" DROP COLUMN "expenseId";
ALTER TABLE "BulkCategorizationRow" ADD CONSTRAINT "BulkCategorizationRow_pkey" PRIMARY KEY ("runId", "itemId");

-- CreateIndex
CREATE INDEX "BulkCategorizationRun_personalAccountId_idx" ON "BulkCategorizationRun"("personalAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "BulkCategorizationRun_scopeType_scopeId_key" ON "BulkCategorizationRun"("scopeType", "scopeId");

-- AddForeignKey
ALTER TABLE "BulkCategorizationRun" ADD CONSTRAINT "BulkCategorizationRun_personalAccountId_fkey" FOREIGN KEY ("personalAccountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

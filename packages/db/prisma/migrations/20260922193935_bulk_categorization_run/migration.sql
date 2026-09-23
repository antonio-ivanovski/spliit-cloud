-- CreateTable
CREATE TABLE "BulkCategorizationRun" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en-US',
    "total" INTEGER NOT NULL DEFAULT 0,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "round" INTEGER NOT NULL DEFAULT 0,
    "applied" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "candidateTotal" INTEGER NOT NULL DEFAULT 0,
    "omitted" INTEGER NOT NULL DEFAULT 0,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "attemptId" TEXT,
    "workerToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "calibration" JSONB NOT NULL DEFAULT '[]',
    "examples" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BulkCategorizationRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BulkCategorizationRun_groupId_key" ON "BulkCategorizationRun"("groupId");

-- CreateTable
CREATE TABLE "BulkCategorizationRow" (
    "runId" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "reviewOrder" INTEGER,
    "title" TEXT NOT NULL,
    "expenseVersion" INTEGER NOT NULL,
    "expenseDate" TIMESTAMPTZ(0) NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'PENDING',
    "categoryId" TEXT NOT NULL DEFAULT 'general',
    "initialCategoryId" TEXT,
    "rerunFeedback" BOOLEAN NOT NULL DEFAULT false,
    "manualCorrection" BOOLEAN NOT NULL DEFAULT false,
    "rerunEligible" BOOLEAN NOT NULL DEFAULT false,
    "rerunTarget" BOOLEAN NOT NULL DEFAULT false,
    "secondPassTarget" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL DEFAULT 'none',
    "choices" JSONB NOT NULL DEFAULT '[]',
    "firstPass" JSONB,
    "secondPass" JSONB,

    CONSTRAINT "BulkCategorizationRow_pkey" PRIMARY KEY ("runId","expenseId")
);

-- CreateIndex
CREATE INDEX "BulkCategorizationRow_runId_stage_position_idx" ON "BulkCategorizationRow"("runId", "stage", "position");

-- CreateIndex
CREATE INDEX "BulkCategorizationRow_runId_reviewOrder_idx" ON "BulkCategorizationRow"("runId", "reviewOrder");

-- CreateIndex
CREATE INDEX "BulkCategorizationRow_runId_rerunTarget_position_idx" ON "BulkCategorizationRow"("runId", "rerunTarget", "position");

-- CreateIndex
CREATE INDEX "BulkCategorizationRow_runId_secondPassTarget_position_idx" ON "BulkCategorizationRow"("runId", "secondPassTarget", "position");

-- CreateIndex
CREATE UNIQUE INDEX "BulkCategorizationRow_runId_position_key" ON "BulkCategorizationRow"("runId", "position");

-- AddForeignKey
ALTER TABLE "BulkCategorizationRun" ADD CONSTRAINT "BulkCategorizationRun_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BulkCategorizationRow" ADD CONSTRAINT "BulkCategorizationRow_runId_fkey" FOREIGN KEY ("runId") REFERENCES "BulkCategorizationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

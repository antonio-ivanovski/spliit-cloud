-- Add a monotonic optimistic-concurrency token to every expense.
ALTER TABLE "Expense"
ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

-- Durable results for replaying authenticated resource-create requests.
CREATE TABLE "IdempotencyRequest" (
    "accountId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "requestId" UUID NOT NULL,
    "requestHash" TEXT NOT NULL,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "IdempotencyRequest_pkey" PRIMARY KEY ("accountId", "operation", "requestId")
);

CREATE INDEX "IdempotencyRequest_createdAt_idx" ON "IdempotencyRequest"("createdAt");

ALTER TABLE "IdempotencyRequest"
ADD CONSTRAINT "IdempotencyRequest_accountId_fkey"
FOREIGN KEY ("accountId") REFERENCES "Account"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

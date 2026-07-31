CREATE TYPE "BudgetPeriod" AS ENUM ('WEEKLY', 'MONTHLY', 'YEARLY', 'CUSTOM');
CREATE TYPE "BudgetScopeMode" AS ENUM ('ALL', 'SELECTED');

CREATE TABLE "GroupBudget" (
  "id" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "ledgerId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "period" "BudgetPeriod" NOT NULL,
  "timeZone" TEXT NOT NULL DEFAULT 'UTC',
  "customStartDate" DATE,
  "customEndDate" DATE,
  "categoryScope" "BudgetScopeMode" NOT NULL DEFAULT 'ALL',
  "categoryNodeIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "participantScope" "BudgetScopeMode" NOT NULL DEFAULT 'ALL',
  "participantIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "notifyTrending" BOOLEAN NOT NULL DEFAULT TRUE,
  "notifyOver" BOOLEAN NOT NULL DEFAULT TRUE,
  "archived" BOOLEAN NOT NULL DEFAULT FALSE,
  "archivedAt" TIMESTAMP(3),
  "createdByAccountId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GroupBudget_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GroupBudget_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "GroupBudget_ledgerId_fkey" FOREIGN KEY ("ledgerId") REFERENCES "Ledger"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "GroupBudget_groupId_archived_idx" ON "GroupBudget"("groupId", "archived");
CREATE INDEX "GroupBudget_ledgerId_archived_idx" ON "GroupBudget"("ledgerId", "archived");

CREATE TYPE "BudgetAlertType" AS ENUM ('TRENDING_OVER', 'OVER');
CREATE TABLE "GroupBudgetAlert" (
  "id" TEXT NOT NULL,
  "budgetId" TEXT NOT NULL,
  "periodStart" DATE NOT NULL,
  "alertType" "BudgetAlertType" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deliveredAt" TIMESTAMP(3),
  CONSTRAINT "GroupBudgetAlert_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GroupBudgetAlert_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "GroupBudget"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "GroupBudgetAlert_budgetId_periodStart_alertType_key" ON "GroupBudgetAlert"("budgetId", "periodStart", "alertType");
CREATE INDEX "GroupBudgetAlert_budgetId_periodStart_idx" ON "GroupBudgetAlert"("budgetId", "periodStart");

-- Normalize legacy taxonomy parent ids (`group:<slug>`) to plain category
-- slugs now that parents are assignable category ids.
UPDATE "GroupBudget"
SET "categoryNodeIds" = ARRAY(
  SELECT DISTINCT CASE
    WHEN elem LIKE 'group:%' THEN substring(elem FROM 7)
    ELSE elem
  END
  FROM unnest("categoryNodeIds") AS elem
)
WHERE EXISTS (
  SELECT 1
  FROM unnest("categoryNodeIds") AS elem
  WHERE elem LIKE 'group:%'
);

UPDATE "GroupBudget"
SET "archivedAt" = "updatedAt"
WHERE "archived" = true;

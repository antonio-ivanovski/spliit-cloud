-- CreateEnum
CREATE TYPE "PersonalTransactionKind" AS ENUM ('EXPENSE', 'INCOME');

-- CreateEnum
CREATE TYPE "PersonalTransactionSource" AS ENUM ('PERSONAL', 'GROUP');

-- CreateEnum
CREATE TYPE "PersonalExpenseState" AS ENUM ('INCLUDE', 'EXCLUDE');

-- CreateTable
CREATE TABLE "PersonalProfile" (
    "accountId" TEXT NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "timeZone" TEXT NOT NULL DEFAULT 'UTC',
    "sharedEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonalProfile_pkey" PRIMARY KEY ("accountId")
);

-- CreateTable
CREATE TABLE "PersonalTransaction" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "accountId" TEXT NOT NULL,
    "kind" "PersonalTransactionKind" NOT NULL,
    "amount" INTEGER NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "originalAmount" INTEGER,
    "originalCurrency" TEXT,
    "conversionRate" DOUBLE PRECISION,
    "conversionSource" "ConversionSource",
    "date" DATE NOT NULL,
    "categoryId" TEXT NOT NULL DEFAULT 'general',
    "title" TEXT,
    "note" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "source" "PersonalTransactionSource" NOT NULL DEFAULT 'PERSONAL',
    "sourceExpenseId" TEXT,
    "sourceGroupId" TEXT,
    "sourceGroupName" TEXT,
    "sourceDetachedAt" TIMESTAMP(3),

    CONSTRAINT "PersonalTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonalGroupRule" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "accountId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "included" BOOLEAN NOT NULL DEFAULT false,
    "includeFrom" DATE,

    CONSTRAINT "PersonalGroupRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonalExpenseOverride" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "accountId" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "state" "PersonalExpenseState",
    "categoryId" TEXT,

    CONSTRAINT "PersonalExpenseOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonalBudget" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "period" "BudgetPeriod" NOT NULL DEFAULT 'MONTHLY',
    "timeZone" TEXT NOT NULL DEFAULT 'UTC',
    "categoryScope" "BudgetScopeMode" NOT NULL DEFAULT 'ALL',
    "categoryIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "startDay" INTEGER NOT NULL DEFAULT 1,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "PersonalBudget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PersonalTransaction_accountId_date_idx" ON "PersonalTransaction"("accountId", "date");

-- CreateIndex
CREATE INDEX "PersonalTransaction_accountId_source_date_idx" ON "PersonalTransaction"("accountId", "source", "date");

-- CreateIndex
CREATE INDEX "PersonalTransaction_accountId_categoryId_date_idx" ON "PersonalTransaction"("accountId", "categoryId", "date");

-- CreateIndex
CREATE INDEX "PersonalTransaction_sourceExpenseId_idx" ON "PersonalTransaction"("sourceExpenseId");

-- CreateIndex
CREATE INDEX "PersonalTransaction_sourceGroupId_idx" ON "PersonalTransaction"("sourceGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "PersonalTransaction_accountId_sourceExpenseId_key" ON "PersonalTransaction"("accountId", "sourceExpenseId");

-- CreateIndex
CREATE INDEX "PersonalGroupRule_accountId_included_idx" ON "PersonalGroupRule"("accountId", "included");

-- CreateIndex
CREATE INDEX "PersonalGroupRule_groupId_idx" ON "PersonalGroupRule"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "PersonalGroupRule_accountId_groupId_key" ON "PersonalGroupRule"("accountId", "groupId");

-- CreateIndex
CREATE INDEX "PersonalExpenseOverride_expenseId_idx" ON "PersonalExpenseOverride"("expenseId");

-- CreateIndex
CREATE UNIQUE INDEX "PersonalExpenseOverride_accountId_expenseId_key" ON "PersonalExpenseOverride"("accountId", "expenseId");

-- CreateIndex
CREATE INDEX "PersonalBudget_accountId_archived_idx" ON "PersonalBudget"("accountId", "archived");

-- AddForeignKey
ALTER TABLE "PersonalProfile" ADD CONSTRAINT "PersonalProfile_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalTransaction" ADD CONSTRAINT "PersonalTransaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalGroupRule" ADD CONSTRAINT "PersonalGroupRule_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalGroupRule" ADD CONSTRAINT "PersonalGroupRule_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalExpenseOverride" ADD CONSTRAINT "PersonalExpenseOverride_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalExpenseOverride" ADD CONSTRAINT "PersonalExpenseOverride_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalBudget" ADD CONSTRAINT "PersonalBudget_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;


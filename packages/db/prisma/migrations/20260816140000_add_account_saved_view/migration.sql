-- CreateTable
CREATE TABLE "AccountSavedView" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "accountId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "viewKey" TEXT NOT NULL,
    "lastOpenedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountSavedView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccountSavedView_accountId_lastOpenedAt_idx" ON "AccountSavedView"("accountId", "lastOpenedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AccountSavedView_accountId_groupId_key" ON "AccountSavedView"("accountId", "groupId");

-- AddForeignKey
ALTER TABLE "AccountSavedView" ADD CONSTRAINT "AccountSavedView_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountSavedView" ADD CONSTRAINT "AccountSavedView_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

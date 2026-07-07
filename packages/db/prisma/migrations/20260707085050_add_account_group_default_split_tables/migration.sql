-- CreateTable
CREATE TABLE "AccountGroupDefaultSplit" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "accountId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "splitMode" "SplitMode" NOT NULL,

    CONSTRAINT "AccountGroupDefaultSplit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountGroupDefaultSplitPaidFor" (
    "defaultSplitId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "shares" INTEGER NOT NULL,

    CONSTRAINT "AccountGroupDefaultSplitPaidFor_pkey" PRIMARY KEY ("defaultSplitId","participantId")
);

-- CreateIndex
CREATE INDEX "AccountGroupDefaultSplit_groupId_idx" ON "AccountGroupDefaultSplit"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountGroupDefaultSplit_accountId_groupId_key" ON "AccountGroupDefaultSplit"("accountId", "groupId");

-- CreateIndex
CREATE INDEX "AccountGroupDefaultSplitPaidFor_participantId_idx" ON "AccountGroupDefaultSplitPaidFor"("participantId");

-- AddForeignKey
ALTER TABLE "AccountGroupDefaultSplit" ADD CONSTRAINT "AccountGroupDefaultSplit_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountGroupDefaultSplit" ADD CONSTRAINT "AccountGroupDefaultSplit_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountGroupDefaultSplitPaidFor" ADD CONSTRAINT "AccountGroupDefaultSplitPaidFor_defaultSplitId_fkey" FOREIGN KEY ("defaultSplitId") REFERENCES "AccountGroupDefaultSplit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountGroupDefaultSplitPaidFor" ADD CONSTRAINT "AccountGroupDefaultSplitPaidFor_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "LedgerParticipant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterEnum
ALTER TYPE "SplitMode" ADD VALUE 'ITEMIZED';

-- CreateTable
CREATE TABLE "ExpenseItem" (
    "id" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "unitPrice" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "splitMode" "SplitMode" NOT NULL DEFAULT 'EVENLY',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpenseItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseItemPaidFor" (
    "expenseItemId" TEXT NOT NULL,
    "ledgerParticipantId" TEXT NOT NULL,
    "shares" INTEGER NOT NULL,

    CONSTRAINT "ExpenseItemPaidFor_pkey" PRIMARY KEY ("expenseItemId","ledgerParticipantId")
);

-- CreateTable
CREATE TABLE "ExpenseItemizedRemainder" (
    "expenseId" TEXT NOT NULL,
    "splitMode" "SplitMode" NOT NULL DEFAULT 'EVENLY',

    CONSTRAINT "ExpenseItemizedRemainder_pkey" PRIMARY KEY ("expenseId")
);

-- CreateTable
CREATE TABLE "ExpenseItemizedRemainderPaidFor" (
    "expenseId" TEXT NOT NULL,
    "ledgerParticipantId" TEXT NOT NULL,
    "shares" INTEGER NOT NULL,

    CONSTRAINT "ExpenseItemizedRemainderPaidFor_pkey" PRIMARY KEY ("expenseId","ledgerParticipantId")
);

-- CreateIndex
CREATE INDEX "ExpenseItem_expenseId_idx" ON "ExpenseItem"("expenseId");

-- AddForeignKey
ALTER TABLE "ExpenseItem" ADD CONSTRAINT "ExpenseItem_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseItemPaidFor" ADD CONSTRAINT "ExpenseItemPaidFor_expenseItemId_fkey" FOREIGN KEY ("expenseItemId") REFERENCES "ExpenseItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseItemPaidFor" ADD CONSTRAINT "ExpenseItemPaidFor_ledgerParticipantId_fkey" FOREIGN KEY ("ledgerParticipantId") REFERENCES "LedgerParticipant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseItemizedRemainder" ADD CONSTRAINT "ExpenseItemizedRemainder_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseItemizedRemainderPaidFor" ADD CONSTRAINT "ExpenseItemizedRemainderPaidFor_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "ExpenseItemizedRemainder"("expenseId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseItemizedRemainderPaidFor" ADD CONSTRAINT "ExpenseItemizedRemainderPaidFor_ledgerParticipantId_fkey" FOREIGN KEY ("ledgerParticipantId") REFERENCES "LedgerParticipant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

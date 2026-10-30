-- AlterTable
ALTER TABLE "PersonalTransaction" ADD COLUMN     "personalRecurringSeriesId" TEXT,
ADD COLUMN     "recurrenceSequence" INTEGER;

-- CreateTable
CREATE TABLE "PersonalRecurringSeries" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "accountId" TEXT NOT NULL,
    "timeZone" TEXT NOT NULL,
    "frequency" "RecurrenceFrequency" NOT NULL,
    "interval" INTEGER NOT NULL,
    "anchorDate" DATE NOT NULL,
    "anchorSequence" INTEGER NOT NULL DEFAULT 1,
    "nextOccurrenceDate" DATE NOT NULL,
    "nextOccurrenceOrdinal" INTEGER NOT NULL DEFAULT 1,
    "endType" "RecurrenceEndType" NOT NULL DEFAULT 'INDEFINITE',
    "occurrenceLimit" INTEGER,
    "endDate" DATE,
    "occurrencesCreated" INTEGER NOT NULL DEFAULT 0,
    "status" "RecurringExpenseSeriesStatus" NOT NULL DEFAULT 'ACTIVE',
    "kind" "PersonalTransactionKind" NOT NULL,
    "amount" INTEGER NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL DEFAULT 'general',
    "title" TEXT,
    "note" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "PersonalRecurringSeries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PersonalRecurringSeries_accountId_status_nextOccurrenceDate_idx" ON "PersonalRecurringSeries"("accountId", "status", "nextOccurrenceDate");

-- CreateIndex
CREATE INDEX "PersonalRecurringSeries_accountId_anchorDate_idx" ON "PersonalRecurringSeries"("accountId", "anchorDate");

-- CreateIndex
CREATE INDEX "PersonalTransaction_personalRecurringSeriesId_recurrenceSeq_idx" ON "PersonalTransaction"("personalRecurringSeriesId", "recurrenceSequence");

-- CreateIndex
CREATE UNIQUE INDEX "PersonalTransaction_personalRecurringSeriesId_recurrenceSeq_key" ON "PersonalTransaction"("personalRecurringSeriesId", "recurrenceSequence");

-- AddForeignKey
ALTER TABLE "PersonalTransaction" ADD CONSTRAINT "PersonalTransaction_personalRecurringSeriesId_fkey" FOREIGN KEY ("personalRecurringSeriesId") REFERENCES "PersonalRecurringSeries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalRecurringSeries" ADD CONSTRAINT "PersonalRecurringSeries_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;


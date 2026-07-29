CREATE TABLE "AccountPreference" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "accountId" TEXT NOT NULL,
    "defaultCurrencyCode" TEXT,
    "timeZone" TEXT,
    "locale" TEXT,
    "theme" TEXT,

    CONSTRAINT "AccountPreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AccountPreference_accountId_key"
  ON "AccountPreference"("accountId");

ALTER TABLE "AccountPreference"
  ADD CONSTRAINT "AccountPreference_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RecurringExpenseSeries"
  ADD COLUMN "timeZone" TEXT NOT NULL DEFAULT 'UTC';

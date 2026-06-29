-- Multi-payer expense support.
--
-- Replaces the single `Expense.paidById` FK with a junction table
-- `ExpensePaidBy` that mirrors `ExpensePaidFor`. Each expense gains a
-- `paidBySplitMode` column with the same enum as `splitMode` (default
-- `BY_AMOUNT` so existing data is consistent — the single payer is
-- distributed as the full amount).
--
-- Backfill: every existing Expense becomes a single-row `ExpensePaidBy`.
-- The single backfilled row is indistinguishable from today's single-payer
-- shape, so callers that haven't migrated yet still see one payer per
-- expense at read time.
--
-- Cross-currency invariant: paid-by `BY_AMOUNT` shares are in the original
-- currency when `originalCurrency` is set. The backfill therefore uses
-- `originalAmount` for cross-currency expenses and `amount` for same-currency
-- expenses. The `GREATEST` guard avoids the zero-share constraint that the
-- domain layer enforces on payer rows; zero-amount reimbursements still need
-- a non-zero shares value to participate in distributions.

-- CreateTable
CREATE TABLE "ExpensePaidBy" (
    "expenseId" TEXT NOT NULL,
    "ledgerParticipantId" TEXT NOT NULL,
    "shares" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ExpensePaidBy_pkey" PRIMARY KEY ("expenseId","ledgerParticipantId")
);

-- CreateIndex
CREATE INDEX "ExpensePaidBy_ledgerParticipantId_idx" ON "ExpensePaidBy"("ledgerParticipantId");

-- AddForeignKey
ALTER TABLE "ExpensePaidBy" ADD CONSTRAINT "ExpensePaidBy_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpensePaidBy" ADD CONSTRAINT "ExpensePaidBy_ledgerParticipantId_fkey" FOREIGN KEY ("ledgerParticipantId") REFERENCES "LedgerParticipant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN "paidBySplitMode" "SplitMode" NOT NULL DEFAULT 'BY_AMOUNT';

-- Backfill: one row per Expense, shares = originalAmount for cross-currency
-- expenses, amount otherwise (GREATEST guard for zero amounts).
-- Done in a single statement so the migration stays in one transaction.
INSERT INTO "ExpensePaidBy" ("expenseId", "ledgerParticipantId", "shares")
SELECT
  "id",
  "paidById",
  GREATEST(
    COALESCE(
      CASE
        WHEN "originalAmount" IS NOT NULL
          AND "originalCurrency" IS NOT NULL
          AND "originalCurrency" <> ''
        THEN "originalAmount"
        ELSE "amount"
      END,
      "amount"
    ),
    1
  )
FROM "Expense";

-- DropForeignKey
ALTER TABLE "Expense" DROP CONSTRAINT "Expense_paidById_fkey";

-- DropColumn
ALTER TABLE "Expense" DROP COLUMN "paidById";

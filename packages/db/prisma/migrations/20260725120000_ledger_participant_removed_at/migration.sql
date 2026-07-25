-- Soft-hide for ledger participants: keep expense history while excluding
-- from Members lists and expense pickers.
ALTER TABLE "LedgerParticipant" ADD COLUMN "removedAt" TIMESTAMP(3);

-- Allow GroupInvitation to optionally materialize a LedgerParticipant row so
-- invited (pending) emails can be selected as payers/paid-for in the expense
-- form before they accept the invitation. The link is nullable and uses
-- SetNull so revoking an invitation does not cascade-delete the participant
-- (historical expenses may still reference it).
ALTER TABLE "GroupInvitation" ADD COLUMN "ledgerParticipantId" TEXT;

ALTER TABLE "GroupInvitation" ADD CONSTRAINT "GroupInvitation_ledgerParticipantId_fkey"
  FOREIGN KEY ("ledgerParticipantId") REFERENCES "LedgerParticipant"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "GroupInvitation_ledgerParticipantId_idx"
  ON "GroupInvitation"("ledgerParticipantId");

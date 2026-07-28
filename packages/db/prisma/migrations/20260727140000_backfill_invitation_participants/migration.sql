-- Backfill LedgerParticipant for pending invitations that lack one.
-- Uses a deterministic ID derived from the invitation ID so the migration
-- is idempotent (conflict-safe on retry).
-- Creates ACCOUNT_MEMBER kind (matching write-time helper) with no display name.

INSERT INTO "LedgerParticipant" (id, "ledgerId", "kind", "displayName")
SELECT
  md5(gi.id || ':pending-ledger-participant'),
  g."ledgerId",
  'ACCOUNT_MEMBER',
  NULL
FROM "GroupInvitation" gi
JOIN "Group" g ON g.id = gi."groupId"
WHERE gi.status = 'PENDING'
  AND gi."ledgerParticipantId" IS NULL
  AND g."ledgerId" IS NOT NULL
ON CONFLICT (id) DO NOTHING;

UPDATE "GroupInvitation" gi
SET "ledgerParticipantId" = md5(gi.id || ':pending-ledger-participant')
FROM "Group" g
WHERE g.id = gi."groupId"
  AND gi.status = 'PENDING'
  AND gi."ledgerParticipantId" IS NULL
  AND g."ledgerId" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "LedgerParticipant" lp
    WHERE lp.id = md5(gi.id || ':pending-ledger-participant')
  );

-- Every name-only participant must have a usable display label. Account-backed
-- participants continue to resolve their name through GroupMember/Account.
UPDATE "LedgerParticipant"
SET "displayName" = 'Unknown participant'
WHERE "kind" = 'UNLINKED_PARTICIPANT'
  AND ("displayName" IS NULL OR btrim("displayName") = '');

ALTER TABLE "LedgerParticipant"
  ADD CONSTRAINT "LedgerParticipant_unlinked_display_name_check"
  CHECK (
    "kind" <> 'UNLINKED_PARTICIPANT'
    OR ("displayName" IS NOT NULL AND btrim("displayName") <> '')
  );

-- Add `kind` and `displayName` to `LedgerParticipant`.
--
-- The import flow materializes a name-only participant for source people
-- who have no app account (e.g. a friend who never signed up to the
-- cloud product). Without these fields, those rows would be visually
-- indistinguishable from real app members — and there's no way to know
-- which name to display. `kind` discriminates the two, `displayName`
-- carries the human-readable label for the unlinked case.
--
-- Default `kind = ACCOUNT_MEMBER` is the safe backfill: every existing
-- row was created by the accept-invitation / create-group flow, so the
-- relation to a `GroupMember` is the source of truth. `displayName` is
-- null for the same reason — the name resolves through the account
-- relation at read time.

-- CreateEnum
CREATE TYPE "LedgerParticipantKind" AS ENUM (
  'ACCOUNT_MEMBER',
  'UNLINKED_PARTICIPANT'
);

-- AlterTable
ALTER TABLE "LedgerParticipant"
  ADD COLUMN "kind" "LedgerParticipantKind" NOT NULL DEFAULT 'ACCOUNT_MEMBER',
  ADD COLUMN "displayName" TEXT;

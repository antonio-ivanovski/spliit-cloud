-- Add link-invite token fields to GroupInvitation.
--
-- Link invitations carry a single-use URL the inviter hands to whoever
-- they want to join. The raw token is returned to the inviter exactly
-- once at create time; the row stores only its hash so the link can be
-- revoked, rotated, or expired without leaking the original URL.
--
-- `tokenHash` is unique so the lookup during accept is a single index
-- hit. `expiresAt` is optional: when set, the API rejects accept
-- attempts after that timestamp. Both columns are nullable so existing
-- EMAIL invitation rows stay valid without a backfill.

-- AlterTable
ALTER TABLE "GroupInvitation"
  ADD COLUMN "tokenHash" TEXT;

ALTER TABLE "GroupInvitation"
  ADD COLUMN "expiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "GroupInvitation_tokenHash_key" ON "GroupInvitation"("tokenHash");

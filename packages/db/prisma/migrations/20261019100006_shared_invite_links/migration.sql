-- Shared (general-purpose multi-person) link invitations: per-link join cap,
-- member-facing label, and plaintext token for member copy-anytime retrieval.
-- `maxUses` NULL means unlimited; the accept gate closes the link once
-- `useCount >= maxUses`. `linkToken` is populated only for shared links and
-- cleared on revoke; `tokenHash` remains the accept/dedupe authority.
ALTER TABLE "GroupInvitation" ADD COLUMN "maxUses" INTEGER,
ADD COLUMN "label" TEXT,
ADD COLUMN "linkToken" TEXT;

-- Backfill existing QR multi-use sessions so the previous hardcoded 30-join
-- session cap becomes data on the row instead of a code constant.
UPDATE "GroupInvitation" SET "maxUses" = 30 WHERE "isMultiUse" = true;

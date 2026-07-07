-- CreateEnum
CREATE TYPE "GroupType" AS ENUM ('GROUP', 'FRIEND');

-- AlterTable: add Group type discriminator + friend pair key.
-- friendPairKey format: "accountAId:accountBId" where accountAId < accountBId.
-- Null during the pending-invitation window, populated when both members join.
ALTER TABLE "Group"
  ADD COLUMN "friendPairKey" TEXT,
  ADD COLUMN "groupType" "GroupType" NOT NULL DEFAULT 'GROUP';

-- Partial unique index: at most one FRIEND group per unordered account pair.
-- Only enforced when friendPairKey is set and the group is FRIEND-typed.
CREATE UNIQUE INDEX "Group_friendPairKey_key"
  ON "Group"("friendPairKey")
  WHERE "friendPairKey" IS NOT NULL AND "groupType" = 'FRIEND';

-- AlterTable: collapse AccountGroupPreference columns.
-- Merge per-account `archived` into `hidden` first so no data is lost, then
-- drop the redundant `archived` and the dormant `pinned` column.
UPDATE "AccountGroupPreference" SET "hidden" = "hidden" OR "archived";

ALTER TABLE "AccountGroupPreference"
  DROP COLUMN "archived",
  DROP COLUMN "pinned";

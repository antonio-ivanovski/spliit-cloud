-- Shared and personal split presets replace the legacy account-owned default
-- split in one final migration. The migration is intentionally direct so
-- supported legacy defaults become private paid-for presets without creating
-- an intermediate two-sided representation.

CREATE TYPE "SplitPresetDefaultMode" AS ENUM ('INHERIT', 'PRESET', 'NEUTRAL');
CREATE TYPE "SplitPresetTarget" AS ENUM ('PAID_BY', 'PAID_FOR');

ALTER TABLE "AccountGroupPreference"
  ADD COLUMN "paidByDefaultMode" "SplitPresetDefaultMode" NOT NULL DEFAULT 'INHERIT',
  ADD COLUMN "paidByDefaultPresetId" TEXT,
  ADD COLUMN "paidForDefaultMode" "SplitPresetDefaultMode" NOT NULL DEFAULT 'INHERIT',
  ADD COLUMN "paidForDefaultPresetId" TEXT;

ALTER TABLE "Group"
  ADD COLUMN "defaultPaidByPresetId" TEXT,
  ADD COLUMN "defaultPaidForPresetId" TEXT;

CREATE TABLE "SplitPreset" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "groupId" TEXT NOT NULL,
    "ownerAccountId" TEXT,
    "scopeKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "target" "SplitPresetTarget" NOT NULL,
    "splitMode" "SplitMode" NOT NULL,

    CONSTRAINT "SplitPreset_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SplitPreset_name_check" CHECK (
      "name" = BTRIM("name")
      AND CHAR_LENGTH("name") BETWEEN 1 AND 120
      AND CHAR_LENGTH("nameKey") >= 1
    ),
    CONSTRAINT "SplitPreset_scope_check" CHECK (
      ("ownerAccountId" IS NULL AND "scopeKey" = 'GROUP')
      OR
      ("ownerAccountId" IS NOT NULL AND "scopeKey" = 'ACCOUNT:' || "ownerAccountId")
    ),
    CONSTRAINT "SplitPreset_mode_check" CHECK (
      "splitMode" IN ('EVENLY', 'BY_SHARES', 'BY_PERCENTAGE')
    )
);

CREATE TABLE "SplitPresetParticipant" (
    "presetId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "shares" INTEGER NOT NULL,

    CONSTRAINT "SplitPresetParticipant_pkey" PRIMARY KEY ("presetId","participantId"),
    CONSTRAINT "SplitPresetParticipant_shares_check" CHECK ("shares" > 0)
);

-- Stage valid legacy rows before dropping the old tables. A legacy definition
-- is intrinsically valid only when every original row satisfies its mode and
-- percentages originally total exactly 10000 basis points. Removed/historical
-- participants are then pruned. Percentage rows that remain are rescaled with
-- largest-remainder rounding; equal remainders are resolved by participant id.
-- This avoids migrating a preset that the final domain schema could not read.
-- Prisma Migrate may commit between statements while deploying a migration.
-- Use a short-lived regular staging table rather than a transaction- or
-- connection-scoped temporary table, then remove it after its final consumer.
CREATE TABLE "_SplitPresetLegacyRows" AS
WITH "LegacyValidDefaults" AS (
  SELECT d."id"
  FROM "AccountGroupDefaultSplit" d
  JOIN "GroupMember" owner
    ON owner."groupId" = d."groupId"
   AND owner."accountId" = d."accountId"
   AND owner."status" = 'ACTIVE'
  JOIN "AccountGroupDefaultSplitPaidFor" original
    ON original."defaultSplitId" = d."id"
  WHERE d."splitMode" IN ('EVENLY', 'BY_SHARES', 'BY_PERCENTAGE')
  GROUP BY d."id", d."splitMode"
  HAVING
    COUNT(*) > 0
    AND BOOL_AND(
      d."splitMode" = 'EVENLY'
      OR (d."splitMode" = 'BY_SHARES' AND original."shares" BETWEEN 1 AND 100000000)
      OR (d."splitMode" = 'BY_PERCENTAGE' AND original."shares" > 0)
    )
    AND (
      d."splitMode" <> 'BY_PERCENTAGE'
      OR SUM(original."shares"::BIGINT) = 10000
    )
),
"RemainingRows" AS (
  SELECT
    d."id" AS "presetId",
    d."createdAt",
    d."updatedAt",
    d."groupId",
    d."accountId" AS "ownerAccountId",
    d."splitMode",
    row."participantId",
    row."shares"::BIGINT,
    SUM(row."shares"::BIGINT) OVER (PARTITION BY d."id") AS "remainingTotal"
  FROM "AccountGroupDefaultSplit" d
  JOIN "LegacyValidDefaults" valid ON valid."id" = d."id"
  JOIN "Group" g ON g."id" = d."groupId"
  JOIN "AccountGroupDefaultSplitPaidFor" row
    ON row."defaultSplitId" = d."id"
  JOIN "LedgerParticipant" participant
    ON participant."id" = row."participantId"
   AND participant."ledgerId" = g."ledgerId"
   AND participant."removedAt" IS NULL
  WHERE
    participant."kind" = 'UNLINKED_PARTICIPANT'
    OR EXISTS (
      SELECT 1
      FROM "GroupInvitation" invitation
      WHERE invitation."ledgerParticipantId" = participant."id"
        AND invitation."status" = 'PENDING'
    )
    OR EXISTS (
      SELECT 1
      FROM "GroupMember" member
      WHERE member."id" = participant."groupMemberId"
        AND member."groupId" = d."groupId"
        AND member."status" = 'ACTIVE'
    )
),
"FlooredRows" AS (
  SELECT
    remaining.*,
    CASE
      WHEN remaining."splitMode" = 'EVENLY' THEN 1::BIGINT
      WHEN remaining."splitMode" = 'BY_SHARES' THEN remaining."shares"
      ELSE (remaining."shares" * 10000) / remaining."remainingTotal"
    END AS "flooredShares",
    CASE
      WHEN remaining."splitMode" = 'BY_PERCENTAGE'
        THEN (remaining."shares" * 10000) % remaining."remainingTotal"
      ELSE 0::BIGINT
    END AS "roundingRemainder"
  FROM "RemainingRows" remaining
),
"RankedRows" AS (
  SELECT
    floored.*,
    CASE
      WHEN floored."splitMode" = 'BY_PERCENTAGE' THEN
        10000 - SUM(floored."flooredShares") OVER (PARTITION BY floored."presetId")
      ELSE 0
    END AS "roundingDeficit",
    ROW_NUMBER() OVER (
      PARTITION BY floored."presetId"
      ORDER BY floored."roundingRemainder" DESC, floored."participantId" ASC
    ) AS "roundingRank"
  FROM "FlooredRows" floored
)
SELECT
  ranked."presetId",
  ranked."createdAt",
  ranked."updatedAt",
  ranked."groupId",
  ranked."ownerAccountId",
  ranked."splitMode",
  ranked."participantId",
  (
    ranked."flooredShares"
    + CASE
        WHEN ranked."roundingRank" <= ranked."roundingDeficit" THEN 1
        ELSE 0
      END
  )::INTEGER AS "shares"
FROM "RankedRows" ranked;

-- Preserve each supported, active member's valid legacy default as a private
-- paid-for preset. BY_AMOUNT is intentionally excluded because it is tied to
-- a particular expense amount.
INSERT INTO "SplitPreset" (
  "id", "createdAt", "updatedAt", "groupId", "ownerAccountId", "scopeKey",
  "name", "nameKey", "target", "splitMode"
)
SELECT
  d."id",
  d."createdAt",
  d."updatedAt",
  d."groupId",
  d."accountId",
  'ACCOUNT:' || d."accountId",
  'Default',
  'default',
  'PAID_FOR'::"SplitPresetTarget",
  d."splitMode"
FROM "AccountGroupDefaultSplit" d
WHERE EXISTS (
  SELECT 1 FROM "_SplitPresetLegacyRows" row WHERE row."presetId" = d."id"
);

INSERT INTO "SplitPresetParticipant" ("presetId", "participantId", "shares")
SELECT row."presetId", row."participantId", row."shares"
FROM "_SplitPresetLegacyRows" row;

INSERT INTO "AccountGroupPreference" (
  "id", "createdAt", "updatedAt", "accountId", "groupId",
  "paidForDefaultMode", "paidForDefaultPresetId"
)
SELECT
  md5('legacy-personal-default:' || d."accountId" || ':' || d."groupId"),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  d."accountId",
  d."groupId",
  'PRESET',
  d."id"
FROM "AccountGroupDefaultSplit" d
WHERE EXISTS (
  SELECT 1 FROM "_SplitPresetLegacyRows" row WHERE row."presetId" = d."id"
)
ON CONFLICT ("accountId", "groupId") DO UPDATE SET
  "paidForDefaultMode" = EXCLUDED."paidForDefaultMode",
  "paidForDefaultPresetId" = EXCLUDED."paidForDefaultPresetId",
  "updatedAt" = CURRENT_TIMESTAMP;

DROP TABLE "_SplitPresetLegacyRows";

CREATE UNIQUE INDEX "SplitPreset_groupId_scopeKey_nameKey_key"
  ON "SplitPreset"("groupId", "scopeKey", "nameKey");
CREATE INDEX "SplitPreset_ownerAccountId_groupId_idx"
  ON "SplitPreset"("ownerAccountId", "groupId");
CREATE INDEX "SplitPresetParticipant_participantId_idx"
  ON "SplitPresetParticipant"("participantId");

ALTER TABLE "SplitPreset" ADD CONSTRAINT "SplitPreset_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SplitPreset" ADD CONSTRAINT "SplitPreset_ownerAccountId_fkey"
  FOREIGN KEY ("ownerAccountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SplitPresetParticipant" ADD CONSTRAINT "SplitPresetParticipant_presetId_fkey"
  FOREIGN KEY ("presetId") REFERENCES "SplitPreset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SplitPresetParticipant" ADD CONSTRAINT "SplitPresetParticipant_participantId_fkey"
  FOREIGN KEY ("participantId") REFERENCES "LedgerParticipant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Group" ADD CONSTRAINT "Group_defaultPaidByPresetId_fkey"
  FOREIGN KEY ("defaultPaidByPresetId") REFERENCES "SplitPreset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Group" ADD CONSTRAINT "Group_defaultPaidForPresetId_fkey"
  FOREIGN KEY ("defaultPaidForPresetId") REFERENCES "SplitPreset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AccountGroupPreference" ADD CONSTRAINT "AccountGroupPreference_paidByDefaultPresetId_fkey"
  FOREIGN KEY ("paidByDefaultPresetId") REFERENCES "SplitPreset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AccountGroupPreference" ADD CONSTRAINT "AccountGroupPreference_paidForDefaultPresetId_fkey"
  FOREIGN KEY ("paidForDefaultPresetId") REFERENCES "SplitPreset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AccountGroupDefaultSplitPaidFor"
  DROP CONSTRAINT "AccountGroupDefaultSplitPaidFor_defaultSplitId_fkey";
ALTER TABLE "AccountGroupDefaultSplitPaidFor"
  DROP CONSTRAINT "AccountGroupDefaultSplitPaidFor_participantId_fkey";
ALTER TABLE "AccountGroupDefaultSplit"
  DROP CONSTRAINT "AccountGroupDefaultSplit_accountId_fkey";
ALTER TABLE "AccountGroupDefaultSplit"
  DROP CONSTRAINT "AccountGroupDefaultSplit_groupId_fkey";

DROP TABLE "AccountGroupDefaultSplitPaidFor";
DROP TABLE "AccountGroupDefaultSplit";

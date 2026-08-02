ALTER TABLE "Group"
ADD COLUMN "subgroupsEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "Subgroup" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subgroup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SubgroupMember" (
    "subgroupId" TEXT NOT NULL,
    "ledgerParticipantId" TEXT NOT NULL,

    CONSTRAINT "SubgroupMember_pkey" PRIMARY KEY ("subgroupId", "ledgerParticipantId")
);

CREATE UNIQUE INDEX "Subgroup_groupId_name_key" ON "Subgroup"("groupId", "name");
CREATE INDEX "Subgroup_groupId_createdAt_idx" ON "Subgroup"("groupId", "createdAt");
CREATE UNIQUE INDEX "SubgroupMember_ledgerParticipantId_key" ON "SubgroupMember"("ledgerParticipantId");

ALTER TABLE "Subgroup"
ADD CONSTRAINT "Subgroup_groupId_fkey"
FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SubgroupMember"
ADD CONSTRAINT "SubgroupMember_subgroupId_fkey"
FOREIGN KEY ("subgroupId") REFERENCES "Subgroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SubgroupMember"
ADD CONSTRAINT "SubgroupMember_ledgerParticipantId_fkey"
FOREIGN KEY ("ledgerParticipantId") REFERENCES "LedgerParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

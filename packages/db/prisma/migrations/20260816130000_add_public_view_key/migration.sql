ALTER TABLE "Group" ADD COLUMN "publicViewKey" TEXT;

CREATE UNIQUE INDEX "Group_publicViewKey_key" ON "Group"("publicViewKey");

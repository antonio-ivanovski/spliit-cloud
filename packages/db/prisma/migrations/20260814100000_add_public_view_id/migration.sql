ALTER TABLE "Group" ADD COLUMN "publicViewId" TEXT;

CREATE UNIQUE INDEX "Group_publicViewId_key" ON "Group"("publicViewId");

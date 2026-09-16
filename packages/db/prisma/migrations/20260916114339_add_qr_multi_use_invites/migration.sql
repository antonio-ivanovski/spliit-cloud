-- AlterTable
ALTER TABLE "GroupInvitation" ADD COLUMN     "isMultiUse" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "useCount" INTEGER NOT NULL DEFAULT 0;

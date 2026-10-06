-- CreateEnum
CREATE TYPE "AccountDeletionStatus" AS ENUM ('PENDING', 'EXECUTING', 'CANCELLED', 'EXECUTED');

-- DropForeignKey
ALTER TABLE "GroupInvitation" DROP CONSTRAINT "GroupInvitation_invitedById_fkey";

-- AlterTable
ALTER TABLE "GroupInvitation" ALTER COLUMN "invitedById" DROP NOT NULL;

-- CreateTable
CREATE TABLE "AccountDeletionRequest" (
    "accountId" TEXT NOT NULL,
    "generation" TEXT,
    "emailSnapshot" TEXT NOT NULL,
    "displayNameSnapshot" TEXT NOT NULL,
    "keepDisplayName" BOOLEAN NOT NULL DEFAULT false,
    "displayNameOverride" TEXT,
    "settleBalances" BOOLEAN NOT NULL DEFAULT true,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executeAt" TIMESTAMP(3) NOT NULL,
    "status" "AccountDeletionStatus" NOT NULL DEFAULT 'PENDING',
    "jobId" TEXT,
    "executedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "AccountDeletionRequest_pkey" PRIMARY KEY ("accountId")
);

-- CreateIndex
CREATE INDEX "AccountDeletionRequest_status_executeAt_idx" ON "AccountDeletionRequest"("status", "executeAt");

-- AddForeignKey
ALTER TABLE "GroupInvitation" ADD CONSTRAINT "GroupInvitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

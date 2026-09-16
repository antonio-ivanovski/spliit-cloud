-- CreateEnum
CREATE TYPE "RemainderAllocationMode" AS ENUM ('CUSTOM', 'PROPORTIONAL');

-- AlterTable
ALTER TABLE "ExpenseItemizedRemainder" ADD COLUMN     "allocationMode" "RemainderAllocationMode" NOT NULL DEFAULT 'CUSTOM';

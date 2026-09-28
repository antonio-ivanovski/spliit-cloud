-- AlterTable
ALTER TABLE "AccountPreference" ADD COLUMN     "groupTabOrder" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "hiddenGroupTabs" TEXT[] DEFAULT ARRAY[]::TEXT[];

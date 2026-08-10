ALTER TABLE "ExpenseDocument"
  ALTER COLUMN "width" DROP NOT NULL,
  ALTER COLUMN "height" DROP NOT NULL,
  ADD COLUMN "fileName" TEXT,
  ADD COLUMN "contentType" TEXT;

-- Conversion provenance: EXCHANGE | CUSTOM only.
-- Null conversionSource means same currency (no conversion).
-- conversionRate is null when conversionSource is null.

CREATE TYPE "ConversionSource" AS ENUM ('EXCHANGE', 'CUSTOM');

ALTER TABLE "Expense"
  ADD COLUMN "conversionSource" "ConversionSource";

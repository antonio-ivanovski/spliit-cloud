-- Conversion provenance: EXCHANGE | CUSTOM only.
-- Null conversionSource means same currency (no conversion).
-- conversionRate is null when conversionSource is null.

CREATE TYPE "ConversionSource" AS ENUM ('EXCHANGE', 'CUSTOM');

ALTER TABLE "Expense"
  ADD COLUMN "conversionSource" "ConversionSource";

-- Legacy converted rows have originalCurrency + conversionRate but no source.
-- Treat them as CUSTOM (matches conversionFromStored fallback).
UPDATE "Expense"
SET "conversionSource" = 'CUSTOM'
WHERE "conversionSource" IS NULL
  AND "originalCurrency" IS NOT NULL
  AND "conversionRate" IS NOT NULL;

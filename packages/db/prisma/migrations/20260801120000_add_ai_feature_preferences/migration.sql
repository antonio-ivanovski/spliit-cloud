ALTER TABLE "AccountPreference"
  ADD COLUMN "aiFeaturesEnabled"         BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "aiCategoryExtractEnabled" BOOLEAN DEFAULT true,
  ADD COLUMN "aiReceiptScanEnabled"      BOOLEAN DEFAULT true,
  ADD COLUMN "aiVoiceExpenseEnabled"     BOOLEAN DEFAULT true;

UPDATE "AccountPreference"
   SET "aiFeaturesEnabled"         = true,
       "aiCategoryExtractEnabled" = true,
       "aiReceiptScanEnabled"      = true,
       "aiVoiceExpenseEnabled"     = true
 WHERE "aiFeaturesEnabled" IS NULL
    OR "aiCategoryExtractEnabled" IS NULL
    OR "aiReceiptScanEnabled"      IS NULL
    OR "aiVoiceExpenseEnabled"     IS NULL;

ALTER TABLE "AccountPreference"
  ADD COLUMN "notificationsEnabled" BOOLEAN NOT NULL DEFAULT true;

UPDATE "AccountPreference"
   SET "notificationsEnabled" = true
 WHERE "notificationsEnabled" IS NULL;

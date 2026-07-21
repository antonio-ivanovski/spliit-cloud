-- Store one Web Push subscription per browser endpoint.
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");
CREATE INDEX "PushSubscription_accountId_idx" ON "PushSubscription"("accountId");

ALTER TABLE "PushSubscription"
  ADD CONSTRAINT "PushSubscription_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Store account-scoped channel preferences by notification category. Both
-- category and channel values are validated in the shared domain package;
-- keeping them as strings avoids Prisma enum migrations for future additions.
CREATE TABLE "AccountNotificationPreference" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "accountId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "channels" TEXT[] NOT NULL,

    CONSTRAINT "AccountNotificationPreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AccountNotificationPreference_accountId_category_key"
  ON "AccountNotificationPreference"("accountId", "category");
CREATE INDEX "AccountNotificationPreference_accountId_idx"
  ON "AccountNotificationPreference"("accountId");

ALTER TABLE "AccountNotificationPreference"
  ADD CONSTRAINT "AccountNotificationPreference_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

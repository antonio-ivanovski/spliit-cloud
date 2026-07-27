CREATE TABLE "NotificationDelivery" (
    "id" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "activityId" TEXT,
    "recipientAccountId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "targetKey" TEXT NOT NULL,
    "pushSubscriptionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "snapshotVersion" INTEGER NOT NULL DEFAULT 1,
    "snapshot" JSONB NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "leaseToken" TEXT,
    "leaseJobId" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "lastErrorKind" TEXT,
    "lastErrorCode" TEXT,
    "lastProviderStatus" INTEGER,
    "lastErrorMessage" TEXT,
    "lastErrorAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "terminalAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificationDelivery_leaseToken_key" ON "NotificationDelivery"("leaseToken");
CREATE UNIQUE INDEX "NotificationDelivery_eventKey_recipientAccountId_channel_targetKey_key" ON "NotificationDelivery"("eventKey", "recipientAccountId", "channel", "targetKey");
CREATE INDEX "NotificationDelivery_status_leaseExpiresAt_idx" ON "NotificationDelivery"("status", "leaseExpiresAt");
CREATE INDEX "NotificationDelivery_status_terminalAt_idx" ON "NotificationDelivery"("status", "terminalAt");
CREATE INDEX "NotificationDelivery_recipientAccountId_idx" ON "NotificationDelivery"("recipientAccountId");
CREATE INDEX "NotificationDelivery_activityId_idx" ON "NotificationDelivery"("activityId");
CREATE INDEX "NotificationDelivery_eventKey_idx" ON "NotificationDelivery"("eventKey");

ALTER TABLE "NotificationDelivery"
  ADD CONSTRAINT "NotificationDelivery_activityId_fkey"
  FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "NotificationDelivery"
  ADD CONSTRAINT "NotificationDelivery_recipientAccountId_fkey"
  FOREIGN KEY ("recipientAccountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

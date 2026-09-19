-- CreateTable
CREATE TABLE "WebhookEndpoint" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "notifyCreated" BOOLEAN NOT NULL DEFAULT true,
    "notifyUpdated" BOOLEAN NOT NULL DEFAULT true,
    "notifyDeleted" BOOLEAN NOT NULL DEFAULT true,
    "involvedOnly" BOOLEAN NOT NULL DEFAULT false,
    "secretVersion" INTEGER NOT NULL DEFAULT 1,
    "lastSuccessAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookEndpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "apiVersion" TEXT NOT NULL DEFAULT 'v1',
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "payload" JSONB NOT NULL,
    "groupId" TEXT,
    "activityId" TEXT,
    "allowAfterDelete" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "lastHttpStatus" INTEGER,
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "sentAt" TIMESTAMP(3),
    "terminalAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDeliveryAttempt" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "outcome" TEXT,
    "httpStatus" INTEGER,
    "durationMs" INTEGER,
    "errorCode" TEXT,
    "errorMessage" TEXT,

    CONSTRAINT "WebhookDeliveryAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebhookEndpoint_accountId_createdAt_idx" ON "WebhookEndpoint"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookEndpoint_accountId_enabled_idx" ON "WebhookEndpoint"("accountId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_sourceKey_key" ON "WebhookEvent"("sourceKey");

-- CreateIndex
CREATE INDEX "WebhookEvent_groupId_occurredAt_idx" ON "WebhookEvent"("groupId", "occurredAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_activityId_idx" ON "WebhookEvent"("activityId");

-- CreateIndex
CREATE INDEX "WebhookEvent_createdAt_idx" ON "WebhookEvent"("createdAt");

-- CreateIndex
CREATE INDEX "WebhookDelivery_status_createdAt_idx" ON "WebhookDelivery"("status", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookDelivery_endpointId_createdAt_idx" ON "WebhookDelivery"("endpointId", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookDelivery_eventId_idx" ON "WebhookDelivery"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookDelivery_endpointId_eventId_key" ON "WebhookDelivery"("endpointId", "eventId");

-- CreateIndex
CREATE INDEX "WebhookDeliveryAttempt_deliveryId_startedAt_idx" ON "WebhookDeliveryAttempt"("deliveryId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookDeliveryAttempt_deliveryId_attempt_key" ON "WebhookDeliveryAttempt"("deliveryId", "attempt");

-- AddForeignKey
ALTER TABLE "WebhookEndpoint" ADD CONSTRAINT "WebhookEndpoint_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "WebhookEndpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "WebhookEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDeliveryAttempt" ADD CONSTRAINT "WebhookDeliveryAttempt_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "WebhookDelivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

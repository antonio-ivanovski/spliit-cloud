-- CreateTable
CREATE TABLE "AnnouncementView" (
    "accountId" TEXT NOT NULL,
    "announcementId" TEXT NOT NULL,
    "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnnouncementView_pkey" PRIMARY KEY ("accountId","announcementId")
);

-- CreateTable
CREATE TABLE "AnnouncementCampaign" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PLANNING',
    "cursor" TEXT,
    "preparedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnnouncementCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnnouncementEmailDelivery" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnnouncementEmailDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AnnouncementView_announcementId_idx" ON "AnnouncementView"("announcementId");

-- CreateIndex
CREATE INDEX "AnnouncementEmailDelivery_status_idx" ON "AnnouncementEmailDelivery"("status");

-- CreateIndex
CREATE UNIQUE INDEX "AnnouncementEmailDelivery_campaignId_accountId_key" ON "AnnouncementEmailDelivery"("campaignId", "accountId");

-- AddForeignKey
ALTER TABLE "AnnouncementView" ADD CONSTRAINT "AnnouncementView_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnouncementEmailDelivery" ADD CONSTRAINT "AnnouncementEmailDelivery_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "AnnouncementCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnouncementEmailDelivery" ADD CONSTRAINT "AnnouncementEmailDelivery_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

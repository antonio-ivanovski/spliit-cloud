-- CreateTable
CREATE TABLE "PersonalAttachment" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "personalTransactionId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "fileName" TEXT,
    "contentType" TEXT,
    "width" INTEGER,
    "height" INTEGER,

    CONSTRAINT "PersonalAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PersonalAttachment_personalTransactionId_idx" ON "PersonalAttachment"("personalTransactionId");

-- CreateIndex
CREATE INDEX "PersonalAttachment_accountId_idx" ON "PersonalAttachment"("accountId");

-- AddForeignKey
ALTER TABLE "PersonalAttachment" ADD CONSTRAINT "PersonalAttachment_personalTransactionId_fkey" FOREIGN KEY ("personalTransactionId") REFERENCES "PersonalTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalAttachment" ADD CONSTRAINT "PersonalAttachment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;


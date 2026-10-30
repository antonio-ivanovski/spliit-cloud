-- CreateTable
CREATE TABLE "PersonalFileImportSource" (
    "personalTransactionId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'GENERIC_CSV',
    "importKey" TEXT NOT NULL,
    "externalIdentityHash" TEXT,
    "semanticHash" TEXT NOT NULL,
    "rawHash" TEXT NOT NULL,
    "meta" JSONB,
    "importedByAccountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PersonalFileImportSource_pkey" PRIMARY KEY ("personalTransactionId")
);
-- CreateIndex
CREATE INDEX "PersonalFileImportSource_accountId_importKey_idx" ON "PersonalFileImportSource"("accountId", "importKey");
-- CreateIndex
CREATE INDEX "PersonalFileImportSource_accountId_provider_extIdHash_idx" ON "PersonalFileImportSource"("accountId", "provider", "externalIdentityHash");
-- AddForeignKey
ALTER TABLE "PersonalFileImportSource" ADD CONSTRAINT "PersonalFileImportSource_personalTransactionId_fkey" FOREIGN KEY ("personalTransactionId") REFERENCES "PersonalTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

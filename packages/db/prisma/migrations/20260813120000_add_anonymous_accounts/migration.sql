ALTER TABLE "Account"
ADD COLUMN "isAnonymous" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "AnonymousRecoveryCredential" (
    "accountId" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "pendingKeyCiphertext" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "onboardingCompletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnonymousRecoveryCredential_pkey" PRIMARY KEY ("accountId")
);

CREATE UNIQUE INDEX "AnonymousRecoveryCredential_keyHash_key"
ON "AnonymousRecoveryCredential"("keyHash");

ALTER TABLE "AnonymousRecoveryCredential"
ADD CONSTRAINT "AnonymousRecoveryCredential_accountId_fkey"
FOREIGN KEY ("accountId") REFERENCES "Account"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

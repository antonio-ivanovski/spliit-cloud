-- Better Auth 1.7.3: account identity is (providerId, accountId) again, as in
-- 1.6. Databases that applied the 1.7.0-1.7.2 issuer schema must relax the
-- NOT NULL constraint (new rows no longer write issuer, so it would reject
-- every sign-up) and drop its unique index, then restore the 1.6 unique key.
-- The column itself is kept nullable for existing rows; dropping it is
-- separate cleanup that can happen whenever.

ALTER TABLE "AuthIdentity" ALTER COLUMN "issuer" DROP NOT NULL;

DROP INDEX "AuthIdentity_issuer_accountId_key";

CREATE UNIQUE INDEX "AuthIdentity_providerId_accountId_key" ON "AuthIdentity"("providerId", "accountId");

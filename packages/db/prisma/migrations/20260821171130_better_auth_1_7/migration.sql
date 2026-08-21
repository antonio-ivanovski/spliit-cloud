-- Better Auth 1.7: account identity is (issuer, accountId), OAuth resources
-- replace the audience list, and oauthClient drops the legacy type/public flags.

-- ---------------------------------------------------------------------------
-- AuthIdentity issuer backfill
-- ---------------------------------------------------------------------------

ALTER TABLE "AuthIdentity" ADD COLUMN "issuer" TEXT;

UPDATE "AuthIdentity"
SET "issuer" = 'local:credential', "accountId" = "userId"
WHERE "providerId" = 'credential';

UPDATE "AuthIdentity"
SET "issuer" = 'https://accounts.google.com'
WHERE "providerId" = 'google';

UPDATE "AuthIdentity"
SET "issuer" = 'local:oauth:github'
WHERE "providerId" = 'github';

UPDATE "AuthIdentity"
SET "issuer" = 'local:oauth:twitter'
WHERE "providerId" = 'twitter';

UPDATE "AuthIdentity"
SET "issuer" = 'local:' || "providerId"
WHERE "issuer" IS NULL AND "providerId" IN ('magic-link', 'anonymous', 'siwe');

-- Remaining identities (typically operator-configured OIDC) use the synthetic
-- OAuth issuer. Generic OAuth is pinned to the same value so returning users
-- keep their existing AuthIdentity rows.
UPDATE "AuthIdentity"
SET "issuer" = 'local:oauth:' || "providerId"
WHERE "issuer" IS NULL;

ALTER TABLE "AuthIdentity" ALTER COLUMN "issuer" SET NOT NULL;

DROP INDEX "AuthIdentity_providerId_accountId_key";

CREATE UNIQUE INDEX "AuthIdentity_issuer_accountId_key" ON "AuthIdentity"("issuer", "accountId");

-- ---------------------------------------------------------------------------
-- OAuth client records
-- ---------------------------------------------------------------------------

ALTER TABLE "oauthClient"
ADD COLUMN "clientDiscoveryId" TEXT,
ADD COLUMN "clientCredentialsScopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "backchannelLogoutUri" TEXT,
ADD COLUMN "backchannelLogoutSessionRequired" BOOLEAN,
ADD COLUMN "applicationType" TEXT,
ADD COLUMN "jwks" TEXT,
ADD COLUMN "jwksUri" TEXT,
ADD COLUMN "dpopBoundAccessTokens" BOOLEAN DEFAULT false;

UPDATE "oauthClient"
SET "applicationType" = "type"
WHERE "type" IN ('web', 'native');

UPDATE "oauthClient"
SET "applicationType" = 'web'
WHERE "applicationType" IS NULL AND "type" = 'user-agent-based';

UPDATE "oauthClient"
SET "tokenEndpointAuthMethod" = 'none'
WHERE "public" = true
  AND ("tokenEndpointAuthMethod" IS NULL OR "tokenEndpointAuthMethod" = '');

UPDATE "oauthClient"
SET "clientCredentialsScopes" = ARRAY[]::TEXT[]
WHERE "clientCredentialsScopes" IS NULL;

ALTER TABLE "oauthClient"
DROP COLUMN "public",
DROP COLUMN "type";

-- ---------------------------------------------------------------------------
-- Protected resources
-- ---------------------------------------------------------------------------

CREATE TABLE "oauthResource" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accessTokenTtl" INTEGER,
    "refreshTokenTtl" INTEGER,
    "signingAlgorithm" TEXT,
    "signingKeyId" TEXT,
    "allowedScopes" JSONB,
    "customClaims" JSONB,
    "dpopBoundAccessTokensRequired" BOOLEAN DEFAULT false,
    "disabled" BOOLEAN DEFAULT false,
    "createdAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3),
    "policyVersion" INTEGER DEFAULT 1,
    "metadata" JSONB,

    CONSTRAINT "oauthResource_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "oauthResource_identifier_key" ON "oauthResource"("identifier");

CREATE TABLE "oauthClientResource" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3),

    CONSTRAINT "oauthClientResource_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "oauthClientResource_clientId_idx" ON "oauthClientResource"("clientId");
CREATE INDEX "oauthClientResource_resourceId_idx" ON "oauthClientResource"("resourceId");
CREATE UNIQUE INDEX "oauthClientResource_clientId_resourceId_key" ON "oauthClientResource"("clientId", "resourceId");

ALTER TABLE "oauthClientResource" ADD CONSTRAINT "oauthClientResource_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "oauthClient"("clientId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oauthClientResource" ADD CONSTRAINT "oauthClientResource_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "oauthResource"("identifier") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "oauthClientAssertion" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oauthClientAssertion_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- Token and consent columns
-- ---------------------------------------------------------------------------

ALTER TABLE "oauthRefreshToken"
ADD COLUMN "authorizationCodeId" TEXT,
ADD COLUMN "resources" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "requestedUserInfoClaims" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "rotatedAt" TIMESTAMP(3),
ADD COLUMN "rotationReplayResponse" TEXT,
ADD COLUMN "rotationReplayExpiresAt" TIMESTAMP(3),
ADD COLUMN "confirmation" JSONB;

CREATE INDEX "oauthRefreshToken_authorizationCodeId_idx" ON "oauthRefreshToken"("authorizationCodeId");

ALTER TABLE "oauthAccessToken"
ADD COLUMN "authorizationCodeId" TEXT,
ADD COLUMN "resources" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "requestedUserInfoClaims" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "revoked" TIMESTAMP(3),
ADD COLUMN "confirmation" JSONB;

CREATE INDEX "oauthAccessToken_authorizationCodeId_idx" ON "oauthAccessToken"("authorizationCodeId");

ALTER TABLE "oauthConsent"
ADD COLUMN "resources" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "requestedUserInfoClaims" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "jwks"
ADD COLUMN "alg" TEXT,
ADD COLUMN "crv" TEXT;

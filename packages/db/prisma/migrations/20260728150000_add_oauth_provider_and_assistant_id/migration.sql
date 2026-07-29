CREATE TABLE "oauthClient" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientSecret" TEXT,
    "disabled" BOOLEAN DEFAULT false,
    "skipConsent" BOOLEAN,
    "enableEndSession" BOOLEAN,
    "subjectType" TEXT,
    "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "userId" TEXT,
    "createdAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3),
    "name" TEXT,
    "uri" TEXT,
    "icon" TEXT,
    "contacts" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "tos" TEXT,
    "policy" TEXT,
    "softwareId" TEXT,
    "softwareVersion" TEXT,
    "softwareStatement" TEXT,
    "redirectUris" TEXT[] NOT NULL,
    "postLogoutRedirectUris" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "tokenEndpointAuthMethod" TEXT,
    "grantTypes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "responseTypes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "public" BOOLEAN,
    "type" TEXT,
    "requirePKCE" BOOLEAN,
    "referenceId" TEXT,
    "metadata" JSONB,
    CONSTRAINT "oauthClient_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "oauthRefreshToken" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "sessionId" TEXT,
    "userId" TEXT NOT NULL,
    "referenceId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3),
    "revoked" TIMESTAMP(3),
    "authTime" TIMESTAMP(3),
    "scopes" TEXT[] NOT NULL,
    CONSTRAINT "oauthRefreshToken_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "oauthAccessToken" (
    "id" TEXT NOT NULL,
    "token" TEXT,
    "clientId" TEXT NOT NULL,
    "sessionId" TEXT,
    "userId" TEXT,
    "referenceId" TEXT,
    "refreshId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3),
    "scopes" TEXT[] NOT NULL,
    CONSTRAINT "oauthAccessToken_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "oauthConsent" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT,
    "referenceId" TEXT,
    "scopes" TEXT[] NOT NULL,
    "createdAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3),
    CONSTRAINT "oauthConsent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "jwks" (
    "id" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "privateKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    CONSTRAINT "jwks_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Expense" ADD COLUMN "assistantRequestId" TEXT;

CREATE UNIQUE INDEX "oauthClient_clientId_key" ON "oauthClient"("clientId");
CREATE INDEX "oauthClient_userId_idx" ON "oauthClient"("userId");
CREATE UNIQUE INDEX "oauthRefreshToken_token_key" ON "oauthRefreshToken"("token");
CREATE INDEX "oauthRefreshToken_clientId_idx" ON "oauthRefreshToken"("clientId");
CREATE INDEX "oauthRefreshToken_sessionId_idx" ON "oauthRefreshToken"("sessionId");
CREATE INDEX "oauthRefreshToken_userId_idx" ON "oauthRefreshToken"("userId");
CREATE UNIQUE INDEX "oauthAccessToken_token_key" ON "oauthAccessToken"("token");
CREATE INDEX "oauthAccessToken_clientId_idx" ON "oauthAccessToken"("clientId");
CREATE INDEX "oauthAccessToken_sessionId_idx" ON "oauthAccessToken"("sessionId");
CREATE INDEX "oauthAccessToken_userId_idx" ON "oauthAccessToken"("userId");
CREATE INDEX "oauthAccessToken_refreshId_idx" ON "oauthAccessToken"("refreshId");
CREATE INDEX "oauthConsent_clientId_idx" ON "oauthConsent"("clientId");
CREATE INDEX "oauthConsent_userId_idx" ON "oauthConsent"("userId");
CREATE UNIQUE INDEX "Expense_assistantRequestId_key" ON "Expense"("assistantRequestId");

ALTER TABLE "oauthClient" ADD CONSTRAINT "oauthClient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oauthRefreshToken" ADD CONSTRAINT "oauthRefreshToken_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "oauthClient"("clientId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oauthRefreshToken" ADD CONSTRAINT "oauthRefreshToken_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "oauthRefreshToken" ADD CONSTRAINT "oauthRefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oauthAccessToken" ADD CONSTRAINT "oauthAccessToken_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "oauthClient"("clientId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oauthAccessToken" ADD CONSTRAINT "oauthAccessToken_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "oauthAccessToken" ADD CONSTRAINT "oauthAccessToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oauthAccessToken" ADD CONSTRAINT "oauthAccessToken_refreshId_fkey" FOREIGN KEY ("refreshId") REFERENCES "oauthRefreshToken"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oauthConsent" ADD CONSTRAINT "oauthConsent_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "oauthClient"("clientId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oauthConsent" ADD CONSTRAINT "oauthConsent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

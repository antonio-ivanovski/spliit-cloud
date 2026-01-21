-- CreateTable
CREATE TABLE "SyncUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "googleId" TEXT,
    "githubId" TEXT,

    CONSTRAINT "SyncUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncedGroup" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "groupName" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncedGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MagicLinkToken" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MagicLinkToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SyncUser_email_key" ON "SyncUser"("email");

-- CreateIndex
CREATE UNIQUE INDEX "SyncUser_googleId_key" ON "SyncUser"("googleId");

-- CreateIndex
CREATE UNIQUE INDEX "SyncUser_githubId_key" ON "SyncUser"("githubId");

-- CreateIndex
CREATE INDEX "SyncedGroup_userId_idx" ON "SyncedGroup"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SyncedGroup_userId_groupId_key" ON "SyncedGroup"("userId", "groupId");

-- CreateIndex
CREATE UNIQUE INDEX "SyncSession_token_key" ON "SyncSession"("token");

-- CreateIndex
CREATE INDEX "SyncSession_userId_idx" ON "SyncSession"("userId");

-- CreateIndex
CREATE INDEX "SyncSession_token_idx" ON "SyncSession"("token");

-- CreateIndex
CREATE UNIQUE INDEX "MagicLinkToken_token_key" ON "MagicLinkToken"("token");

-- CreateIndex
CREATE INDEX "MagicLinkToken_token_idx" ON "MagicLinkToken"("token");

-- AddForeignKey
ALTER TABLE "SyncedGroup" ADD CONSTRAINT "SyncedGroup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "SyncUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncSession" ADD CONSTRAINT "SyncSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "SyncUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

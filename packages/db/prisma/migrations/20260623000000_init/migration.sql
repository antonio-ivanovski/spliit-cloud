-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "GroupRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "GroupMemberStatus" AS ENUM ('PENDING', 'ACTIVE', 'LEFT', 'REMOVED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "GroupInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'REVOKED');

-- CreateEnum
CREATE TYPE "SplitMode" AS ENUM ('EVENLY', 'BY_SHARES', 'BY_PERCENTAGE', 'BY_AMOUNT');

-- CreateEnum
CREATE TYPE "RecurrenceRule" AS ENUM ('NONE', 'DAILY', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('UPDATE_GROUP', 'CREATE_EXPENSE', 'UPDATE_EXPENSE', 'DELETE_EXPENSE');

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT NOT NULL,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthIdentity" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "providerId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,

    CONSTRAINT "AuthIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Verification" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "identifier" TEXT NOT NULL,

    CONSTRAINT "Verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ledger" (
    "id" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT '$',
    "currencyCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerParticipant" (
    "id" TEXT NOT NULL,
    "ledgerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "groupMemberId" TEXT,

    CONSTRAINT "LedgerParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Group" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "information" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ledgerId" TEXT NOT NULL,

    CONSTRAINT "Group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupMember" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "groupId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "role" "GroupRole" NOT NULL DEFAULT 'MEMBER',
    "status" "GroupMemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "displayName" TEXT,
    "joinedAt" TIMESTAMP(3),
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "GroupMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupInvitation" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "groupId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "GroupRole" NOT NULL DEFAULT 'MEMBER',
    "status" "GroupInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "invitedById" TEXT NOT NULL,
    "acceptedById" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "ledgerParticipantId" TEXT,

    CONSTRAINT "GroupInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountGroupPreference" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "accountId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "starred" BOOLEAN NOT NULL DEFAULT false,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "hidden" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AccountGroupPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" SERIAL NOT NULL,
    "grouping" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- Seed built-in categories. The application treats id 0 as the default
-- "General" category.
INSERT INTO "Category" ("id", "grouping", "name") VALUES (0, 'Uncategorized', 'General');
INSERT INTO "Category" ("id", "grouping", "name") VALUES (1, 'Uncategorized', 'Payment');
INSERT INTO "Category" ("id", "grouping", "name") VALUES (2, 'Entertainment', 'Entertainment');
INSERT INTO "Category" ("id", "grouping", "name") VALUES (3, 'Entertainment', 'Games');
INSERT INTO "Category" ("id", "grouping", "name") VALUES (4, 'Entertainment', 'Movies');
INSERT INTO "Category" ("id", "grouping", "name") VALUES (5, 'Entertainment', 'Music');
INSERT INTO "Category" ("id", "grouping", "name") VALUES (6, 'Entertainment', 'Sports');
INSERT INTO "Category" ("id", "grouping", "name") VALUES (7, 'Food and Drink', 'Food and Drink');
INSERT INTO "Category" ("id", "grouping", "name") VALUES (8, 'Food and Drink', 'Dining Out');
INSERT INTO "Category" ("id", "grouping", "name") VALUES (9, 'Food and Drink', 'Groceries');
INSERT INTO "Category" ("id", "grouping", "name") VALUES (10, 'Food and Drink', 'Liquor');
INSERT INTO "Category" ("id", "grouping", "name") VALUES (11, 'Home', 'Home');
INSERT INTO "Category" ("id", "grouping", "name") VALUES (12, 'Home', 'Electronics');
INSERT INTO "Category" ("id", "grouping", "name") VALUES (13, 'Home', 'Furniture');
INSERT INTO "Category" ("id", "grouping", "name") VALUES (14, 'Home', 'Household Supplies');
INSERT INTO "Category" ("id", "grouping", "name") VALUES (15, 'Home', 'Maintenance');
INSERT INTO "Category" ("id", "grouping", "name") VALUES (16, 'Home', 'Mortgage');
INSERT INTO "Category" ("id", "grouping", "name") VALUES (17, 'Home', 'Pets');
INSERT INTO "Category" ("id", "grouping", "name") VALUES (18, 'Home', 'Rent');
INSERT INTO "Category" ("id", "grouping", "name") VALUES (19, 'Home', 'Services');
INSERT INTO "Category" ("id", "grouping", "name") VALUES (20, 'Life', 'Childcare');
INSERT INTO "Category" ("id", "grouping", "name") VALUES (21, 'Life', 'Clothing');
INSERT INTO "Category" ("id", "grouping", "name") VALUES (22, 'Life', 'Education');
INSERT INTO "Category" ("id", "grouping", "name") VALUES (23, 'Life', 'Gifts');
INSERT INTO "Category" ("id", "grouping", "name") VALUES (24, 'Life', 'Insurance');
INSERT INTO "Category" ("id", "grouping", "name") VALUES (25, 'Life', 'Medical Expenses');
INSERT INTO "Category" ("id", "grouping", "name") VALUES (26, 'Life', 'Taxes');
INSERT INTO "Category" ("id", "grouping", "name") VALUES (27, 'Transportation', 'Transportation');
INSERT INTO "Category" ("id", "grouping", "name") VALUES (28, 'Transportation', 'Bicycle');
INSERT INTO "Category" ("id", "grouping", "name") VALUES (29, 'Transportation', 'Bus/Train');
INSERT INTO "Category" ("id", "grouping", "name") VALUES (30, 'Transportation', 'Car');
INSERT INTO "Category" ("id", "grouping", "name") VALUES (31, 'Transportation', 'Gas/Fuel');
INSERT INTO "Category" ("id", "grouping", "name") VALUES (32, 'Transportation', 'Hotel');
INSERT INTO "Category" ("id", "grouping", "name") VALUES (33, 'Transportation', 'Parking');
INSERT INTO "Category" ("id", "grouping", "name") VALUES (34, 'Transportation', 'Plane');
INSERT INTO "Category" ("id", "grouping", "name") VALUES (35, 'Transportation', 'Taxi');
INSERT INTO "Category" ("id", "grouping", "name") VALUES (36, 'Utilities', 'Utilities');
INSERT INTO "Category" ("id", "grouping", "name") VALUES (37, 'Utilities', 'Cleaning');
INSERT INTO "Category" ("id", "grouping", "name") VALUES (38, 'Utilities', 'Electricity');
INSERT INTO "Category" ("id", "grouping", "name") VALUES (39, 'Utilities', 'Heat/Gas');
INSERT INTO "Category" ("id", "grouping", "name") VALUES (40, 'Utilities', 'Trash');
INSERT INTO "Category" ("id", "grouping", "name") VALUES (41, 'Utilities', 'TV/Phone/Internet');
INSERT INTO "Category" ("id", "grouping", "name") VALUES (42, 'Utilities', 'Water');
INSERT INTO "Category" ("id", "grouping", "name") VALUES (43, 'Life', 'Donation');

SELECT setval(pg_get_serial_sequence('"Category"', 'id'), (SELECT MAX("id") FROM "Category"));

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "ledgerId" TEXT NOT NULL,
    "expenseDate" DATE NOT NULL DEFAULT CURRENT_DATE,
    "title" TEXT NOT NULL,
    "categoryId" INTEGER NOT NULL DEFAULT 0,
    "amount" INTEGER NOT NULL,
    "originalAmount" INTEGER,
    "originalCurrency" TEXT,
    "conversionRate" DECIMAL(65,30),
    "paidById" TEXT NOT NULL,
    "isReimbursement" BOOLEAN NOT NULL DEFAULT false,
    "splitMode" "SplitMode" NOT NULL DEFAULT 'EVENLY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "recurrenceRule" "RecurrenceRule" NOT NULL DEFAULT 'NONE',

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseDocument" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "expenseId" TEXT,
    "ledgerId" TEXT,

    CONSTRAINT "ExpenseDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringExpenseLink" (
    "id" TEXT NOT NULL,
    "ledgerId" TEXT NOT NULL,
    "currentFrameExpenseId" TEXT NOT NULL,
    "nextExpenseCreatedAt" TIMESTAMP(3),
    "nextExpenseDate" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringExpenseLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpensePaidFor" (
    "expenseId" TEXT NOT NULL,
    "ledgerParticipantId" TEXT NOT NULL,
    "shares" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ExpensePaidFor_pkey" PRIMARY KEY ("expenseId","ledgerParticipantId")
);

-- CreateTable
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL,
    "ledgerId" TEXT NOT NULL,
    "time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activityType" "ActivityType" NOT NULL,
    "ledgerParticipantId" TEXT,
    "accountId" TEXT,
    "expenseId" TEXT,
    "data" TEXT,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_email_key" ON "Account"("email");

-- CreateIndex
CREATE INDEX "AuthIdentity_userId_idx" ON "AuthIdentity"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AuthIdentity_providerId_accountId_key" ON "AuthIdentity"("providerId", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Verification_identifier_idx" ON "Verification"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerParticipant_groupMemberId_key" ON "LedgerParticipant"("groupMemberId");

-- CreateIndex
CREATE INDEX "LedgerParticipant_ledgerId_idx" ON "LedgerParticipant"("ledgerId");

-- CreateIndex
CREATE UNIQUE INDEX "Group_ledgerId_key" ON "Group"("ledgerId");

-- CreateIndex
CREATE INDEX "GroupMember_accountId_idx" ON "GroupMember"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupMember_groupId_accountId_key" ON "GroupMember"("groupId", "accountId");

-- CreateIndex
CREATE INDEX "GroupInvitation_groupId_idx" ON "GroupInvitation"("groupId");

-- CreateIndex
CREATE INDEX "GroupInvitation_email_idx" ON "GroupInvitation"("email");

-- CreateIndex
CREATE INDEX "GroupInvitation_email_status_idx" ON "GroupInvitation"("email", "status");

-- CreateIndex
CREATE INDEX "GroupInvitation_groupId_status_idx" ON "GroupInvitation"("groupId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AccountGroupPreference_accountId_groupId_key" ON "AccountGroupPreference"("accountId", "groupId");

-- CreateIndex
CREATE INDEX "Expense_ledgerId_idx" ON "Expense"("ledgerId");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringExpenseLink_currentFrameExpenseId_key" ON "RecurringExpenseLink"("currentFrameExpenseId");

-- CreateIndex
CREATE INDEX "RecurringExpenseLink_ledgerId_idx" ON "RecurringExpenseLink"("ledgerId");

-- CreateIndex
CREATE INDEX "RecurringExpenseLink_ledgerId_nextExpenseCreatedAt_nextExpe_idx" ON "RecurringExpenseLink"("ledgerId", "nextExpenseCreatedAt", "nextExpenseDate" DESC);

-- CreateIndex
CREATE INDEX "Activity_ledgerId_idx" ON "Activity"("ledgerId");

-- AddForeignKey
ALTER TABLE "AuthIdentity" ADD CONSTRAINT "AuthIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerParticipant" ADD CONSTRAINT "LedgerParticipant_ledgerId_fkey" FOREIGN KEY ("ledgerId") REFERENCES "Ledger"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerParticipant" ADD CONSTRAINT "LedgerParticipant_groupMemberId_fkey" FOREIGN KEY ("groupMemberId") REFERENCES "GroupMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Group" ADD CONSTRAINT "Group_ledgerId_fkey" FOREIGN KEY ("ledgerId") REFERENCES "Ledger"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupInvitation" ADD CONSTRAINT "GroupInvitation_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupInvitation" ADD CONSTRAINT "GroupInvitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupInvitation" ADD CONSTRAINT "GroupInvitation_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupInvitation" ADD CONSTRAINT "GroupInvitation_ledgerParticipantId_fkey" FOREIGN KEY ("ledgerParticipantId") REFERENCES "LedgerParticipant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountGroupPreference" ADD CONSTRAINT "AccountGroupPreference_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountGroupPreference" ADD CONSTRAINT "AccountGroupPreference_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_ledgerId_fkey" FOREIGN KEY ("ledgerId") REFERENCES "Ledger"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_paidById_fkey" FOREIGN KEY ("paidById") REFERENCES "LedgerParticipant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseDocument" ADD CONSTRAINT "ExpenseDocument_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseDocument" ADD CONSTRAINT "ExpenseDocument_ledgerId_fkey" FOREIGN KEY ("ledgerId") REFERENCES "Ledger"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringExpenseLink" ADD CONSTRAINT "RecurringExpenseLink_currentFrameExpenseId_fkey" FOREIGN KEY ("currentFrameExpenseId") REFERENCES "Expense"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringExpenseLink" ADD CONSTRAINT "RecurringExpenseLink_ledgerId_fkey" FOREIGN KEY ("ledgerId") REFERENCES "Ledger"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpensePaidFor" ADD CONSTRAINT "ExpensePaidFor_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpensePaidFor" ADD CONSTRAINT "ExpensePaidFor_ledgerParticipantId_fkey" FOREIGN KEY ("ledgerParticipantId") REFERENCES "LedgerParticipant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_ledgerId_fkey" FOREIGN KEY ("ledgerId") REFERENCES "Ledger"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_ledgerParticipantId_fkey" FOREIGN KEY ("ledgerParticipantId") REFERENCES "LedgerParticipant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;


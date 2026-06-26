-- Drop denormalized display-name fields.
--
-- `LedgerParticipant.name` and `GroupMember.displayName` were snapshotted
-- from `Account.name` at group-create / invitation-accept time, so renaming
-- the account did not propagate to existing groups, expenses, balances,
-- activity entries, or the participants list. Both fields are dropped here
-- and the display name is now always resolved through the relation to
-- `Account.name` (account-backed participants) or `GroupInvitation.email`
-- (pending invitations).
--
-- Accounts are never deleted in the application, so a member who leaves
-- a group keeps their ledger participant row joined to their account —
-- expenses and balances still resolve to the current account name.

-- AlterTable
ALTER TABLE "GroupMember" DROP COLUMN "displayName";

-- AlterTable
ALTER TABLE "LedgerParticipant" DROP COLUMN "name";
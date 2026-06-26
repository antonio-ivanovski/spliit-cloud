-- Add invitation kind and an optional pending-only label.
--
-- Today `GroupInvitation.email` is overloaded: it identifies the invite
-- target, the pending invitee display name, and the acceptance
-- authorization key. The handoff introduces:
--
--   * `type GroupInvitationType` so the model can carry multiple invite
--     target kinds. `EMAIL` matches a specific recipient; `LINK` is
--     shareable and stores a unique synthetic email placeholder of the
--     form `${token}@link.placeholder.local` (the `.placeholder.local`
--     reserved suffix marks "not a real address" — see
--     `lib/invitations.ts` for the generator).
--   * `temporaryName String?` so admins can give a pending invitee a
--     human-readable label that wins over the email in the expense
--     form, balances, activity feed, and exports. The label is
--     pending-only: after acceptance, `Account.name` resolves the
--     participant. Historical rows keep whatever label they had so the
--     activity feed still renders meaningful names for past expenses.
--
-- `email` stays `NOT NULL`. For LINK invitations the value is the
-- unique synthetic placeholder; the global unique constraint on
-- `Account.email` therefore continues to back the "this is the
-- address for this user" contract and the column never needs to go
-- nullable. The default value on `type` is applied at insert time, so
-- the explicit `DEFAULT 'EMAIL'` here also backfills the existing
-- rows to `EMAIL`.

-- CreateEnum
CREATE TYPE "GroupInvitationType" AS ENUM ('EMAIL', 'LINK');

-- AlterTable
ALTER TABLE "GroupInvitation"
  ADD COLUMN "type" "GroupInvitationType" NOT NULL DEFAULT 'EMAIL';

ALTER TABLE "GroupInvitation"
  ADD COLUMN "temporaryName" TEXT;

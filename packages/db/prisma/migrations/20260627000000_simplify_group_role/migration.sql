-- Simplify group roles: collapse OWNER into ADMIN.
--
-- Prior product had three roles (OWNER, ADMIN, MEMBER); the handoff
-- collapses the model to two (ADMIN, MEMBER) where ADMIN inherits the
-- prior OWNER behavior. Existing rows that previously stored OWNER are
-- rewritten to ADMIN inside the cast so the new enum can be created
-- without a value the data would otherwise need to keep.
--
-- Postgres doesn't let us ALTER TYPE ... DROP VALUE for an in-use
-- value, so we replace the type with a new one in the same shape minus
-- OWNER and swap the underlying column type with a USING clause that
-- folds OWNER -> ADMIN during the cast.

CREATE TYPE "GroupRole_new" AS ENUM ('ADMIN', 'MEMBER');

ALTER TABLE "GroupMember"
  ALTER COLUMN "role" DROP DEFAULT;

ALTER TABLE "GroupMember"
  ALTER COLUMN "role" TYPE "GroupRole_new"
  USING (
    CASE
      WHEN "role"::text = 'OWNER' THEN 'ADMIN'::"GroupRole_new"
      ELSE "role"::text::"GroupRole_new"
    END
  );

ALTER TABLE "GroupMember"
  ALTER COLUMN "role" SET DEFAULT 'MEMBER';

ALTER TABLE "GroupInvitation"
  ALTER COLUMN "role" DROP DEFAULT;

ALTER TABLE "GroupInvitation"
  ALTER COLUMN "role" TYPE "GroupRole_new"
  USING (
    CASE
      WHEN "role"::text = 'OWNER' THEN 'ADMIN'::"GroupRole_new"
      ELSE "role"::text::"GroupRole_new"
    END
  );

ALTER TABLE "GroupInvitation"
  ALTER COLUMN "role" SET DEFAULT 'MEMBER';

DROP TYPE "GroupRole";

ALTER TYPE "GroupRole_new" RENAME TO "GroupRole";
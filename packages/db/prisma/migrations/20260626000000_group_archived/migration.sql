-- Add a group-level `archived` flag. OWNER/ADMIN can set it through the
-- `groups.archive` tRPC mutation; when true, the group is read-only for
-- every member and appears in the "Archived" section of their group list.
-- This is distinct from the existing per-account `AccountGroupPreference.archived`
-- column, which the API now exposes as the per-account "hide" preference.
ALTER TABLE "Group" ADD COLUMN "archived" BOOLEAN NOT NULL DEFAULT false;

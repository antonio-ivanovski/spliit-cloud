-- Scoped G1 fix for the offline revision-token audit (handoff/2026-10-07-revision-coverage-audit.md).
--
-- The viewer self-bump trigger on "AccountGroupPreference" fired on UPDATE only,
-- so the FIRST star/hide via `account.setPreference` (a Prisma upsert) created the
-- row with the column default `offlineViewerRevision = 0` -- the exact token
-- (`o1.cX.v0`) the client already holds for the no-row default state. The visible
-- projection changed while the token did not, so stale viewer state would be
-- silently confirmed as fresh.
--
-- This migration extends the existing self-bump to BEFORE INSERT: a newly created
-- preference row starts at revision 1, so upsert-create advances the viewer part
-- of the token exactly once. No app-code change is needed: the app never writes
-- revision columns, and the BEFORE trigger mutates only NEW (no second write,
-- no recursion, single bump per row).
--
-- Deliberately no DELETE trigger: there is no app DELETE path for preference
-- rows; cascades only fire on account/group removal where the token is moot.
--
-- Single-bump guards (mirroring 20261006195248_offline_revision_tokens): the
-- UPDATE path keeps the revision-only recognition (`IS DISTINCT FROM`), so a
-- revision-only write is not counted twice; the INSERT path bumps
-- `COALESCE(NEW."offlineViewerRevision", 0) + 1`, which is 0 -> 1 on the normal
-- defaulted path and preserves +1 semantics if a revision were ever supplied.
CREATE OR REPLACE FUNCTION spliit_preference_revision_self()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW."offlineViewerRevision" := COALESCE(NEW."offlineViewerRevision", 0) + 1;
    RETURN NEW;
  END IF;
  IF NEW."offlineViewerRevision" IS DISTINCT FROM OLD."offlineViewerRevision" THEN
    RETURN NEW;
  END IF;
  NEW."offlineViewerRevision" := OLD."offlineViewerRevision" + 1;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS spliit_preference_revision_self_trigger ON "AccountGroupPreference";
CREATE TRIGGER spliit_preference_revision_self_trigger
BEFORE INSERT OR UPDATE ON "AccountGroupPreference"
FOR EACH ROW EXECUTE FUNCTION spliit_preference_revision_self();

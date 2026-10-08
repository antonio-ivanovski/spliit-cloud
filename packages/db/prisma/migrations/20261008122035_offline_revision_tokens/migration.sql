-- Offline revision tokens for the read-only offline initial release.
--
-- Adds per-group content revision and per-viewer preference revision counters,
-- bumped in-transaction by PostgreSQL triggers on every table projected into
-- the offline catalog/snapshot payloads. Clients compare the composed token
-- (contract version + content revision + viewer revision) to skip unchanged
-- histories without refetching them.
--
-- Dependency coverage (see apps/api/src/lib/api/offline.ts):
--   Group (self), Ledger, GroupMember, LedgerParticipant, GroupInvitation,
--   Subgroup, SubgroupMember, SplitPreset, SplitPresetParticipant, Expense,
--   ExpensePaidBy, ExpensePaidFor, ExpenseItem, ExpenseItemPaidFor,
--   ExpenseItemizedRemainder, ExpenseItemizedRemainderPaidFor, ExpenseDocument,
--   RecurringExpenseSeries, ExpenseFileImportSource, Account (display name /
--   image, fanned out to every ACTIVE membership group), AccountGroupPreference
--   (viewer revision, self-bump).
--
-- Coverage includes the v2 snapshot payloads: ExpenseComment (full history),
-- GroupBudget plus GroupBudgetAlert (budgets with server-computed summaries),
-- and Activity (recent feed window).
--
-- Deliberately NOT covered (never projected into offline payloads):
--   BulkCategorizationRun/Rows, AccountSavedView, AccountPreference,
--   notification/webhook/auth tables.
--
-- Over-bump policy: dependent triggers fire on any INSERT/UPDATE/DELETE rather
-- than an enumerated column list, so a future column that lands in the offline
-- projection can never silently miss a bump (the failure mode that would serve
-- stale data as confirmed). The cost is an occasional redundant refetch. The
-- only guarded trigger is Account(display name/image), because sign-in flows
-- rewrite that row without changing visible content.

ALTER TABLE "Group" ADD COLUMN "offlineContentRevision" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "AccountGroupPreference" ADD COLUMN "offlineViewerRevision" BIGINT NOT NULL DEFAULT 0;

-- Bump exactly one group by id. Separate UPDATE (not BEFORE-trigger logic) so
-- the Group self-bump below recognises it as a revision-only write and does
-- not double-count.
CREATE OR REPLACE FUNCTION spliit_touch_group_offline_revision(p_group_id TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "Group"
  SET "offlineContentRevision" = "offlineContentRevision" + 1
  WHERE id = p_group_id;
END;
$$;

-- Bump the group that owns a ledger (ledgers never move between groups, but
-- both OLD and NEW ids are accepted so callers stay symmetric).
CREATE OR REPLACE FUNCTION spliit_touch_groups_for_ledger(p_ledger_id TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "Group"
  SET "offlineContentRevision" = "offlineContentRevision" + 1
  WHERE "ledgerId" = p_ledger_id;
END;
$$;

-- Bump the group that owns an expense.
CREATE OR REPLACE FUNCTION spliit_touch_groups_for_expense(p_expense_id TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "Group" g
  SET "offlineContentRevision" = g."offlineContentRevision" + 1
  FROM "Expense" e
  WHERE e.id = p_expense_id AND g."ledgerId" = e."ledgerId";
END;
$$;

-- Self-bump: any application write to a Group row advances its content
-- revision. Revision-only writes issued by the dependent triggers below carry
-- a changed revision and are recognised so they are not counted twice.
CREATE OR REPLACE FUNCTION spliit_group_revision_self()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;
  IF NEW."offlineContentRevision" IS DISTINCT FROM OLD."offlineContentRevision" THEN
    RETURN NEW;
  END IF;
  NEW."offlineContentRevision" := OLD."offlineContentRevision" + 1;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS spliit_group_revision_self_trigger ON "Group";
CREATE TRIGGER spliit_group_revision_self_trigger
BEFORE UPDATE ON "Group"
FOR EACH ROW EXECUTE FUNCTION spliit_group_revision_self();

-- Self-bump for the viewer revision on preference rows. Same no-double-count
-- guard as the group self-bump.
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

-- Tables carrying a direct groupId.
CREATE OR REPLACE FUNCTION spliit_touch_group_from_group_id()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM spliit_touch_group_offline_revision(OLD."groupId");
    RETURN NULL;
  END IF;
  PERFORM spliit_touch_group_offline_revision(NEW."groupId");
  IF TG_OP = 'UPDATE' AND NEW."groupId" IS DISTINCT FROM OLD."groupId" THEN
    PERFORM spliit_touch_group_offline_revision(OLD."groupId");
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS spliit_offline_rev_groupmember ON "GroupMember";
CREATE TRIGGER spliit_offline_rev_groupmember
AFTER INSERT OR UPDATE OR DELETE ON "GroupMember"
FOR EACH ROW EXECUTE FUNCTION spliit_touch_group_from_group_id();

DROP TRIGGER IF EXISTS spliit_offline_rev_invitation ON "GroupInvitation";
CREATE TRIGGER spliit_offline_rev_invitation
AFTER INSERT OR UPDATE OR DELETE ON "GroupInvitation"
FOR EACH ROW EXECUTE FUNCTION spliit_touch_group_from_group_id();

DROP TRIGGER IF EXISTS spliit_offline_rev_subgroup ON "Subgroup";
CREATE TRIGGER spliit_offline_rev_subgroup
AFTER INSERT OR UPDATE OR DELETE ON "Subgroup"
FOR EACH ROW EXECUTE FUNCTION spliit_touch_group_from_group_id();

DROP TRIGGER IF EXISTS spliit_offline_rev_preset ON "SplitPreset";
CREATE TRIGGER spliit_offline_rev_preset
AFTER INSERT OR UPDATE OR DELETE ON "SplitPreset"
FOR EACH ROW EXECUTE FUNCTION spliit_touch_group_from_group_id();

-- Ledger-owned rows: resolve the group through the ledger.
CREATE OR REPLACE FUNCTION spliit_touch_group_from_ledger_id()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM spliit_touch_groups_for_ledger(OLD."ledgerId");
    RETURN NULL;
  END IF;
  PERFORM spliit_touch_groups_for_ledger(NEW."ledgerId");
  IF TG_OP = 'UPDATE' AND NEW."ledgerId" IS DISTINCT FROM OLD."ledgerId" THEN
    PERFORM spliit_touch_groups_for_ledger(OLD."ledgerId");
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS spliit_offline_rev_participant ON "LedgerParticipant";
CREATE TRIGGER spliit_offline_rev_participant
AFTER INSERT OR UPDATE OR DELETE ON "LedgerParticipant"
FOR EACH ROW EXECUTE FUNCTION spliit_touch_group_from_ledger_id();

DROP TRIGGER IF EXISTS spliit_offline_rev_expense ON "Expense";
CREATE TRIGGER spliit_offline_rev_expense
AFTER INSERT OR UPDATE OR DELETE ON "Expense"
FOR EACH ROW EXECUTE FUNCTION spliit_touch_group_from_ledger_id();

DROP TRIGGER IF EXISTS spliit_offline_rev_series ON "RecurringExpenseSeries";
CREATE TRIGGER spliit_offline_rev_series
AFTER INSERT OR UPDATE OR DELETE ON "RecurringExpenseSeries"
FOR EACH ROW EXECUTE FUNCTION spliit_touch_group_from_ledger_id();

-- The Ledger row itself (currency / currencyCode are projected).
CREATE OR REPLACE FUNCTION spliit_touch_group_from_ledger_id_from_id()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM spliit_touch_groups_for_ledger(OLD.id);
    RETURN NULL;
  END IF;
  PERFORM spliit_touch_groups_for_ledger(NEW.id);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS spliit_offline_rev_ledger ON "Ledger";
CREATE TRIGGER spliit_offline_rev_ledger
AFTER INSERT OR UPDATE OR DELETE ON "Ledger"
FOR EACH ROW EXECUTE FUNCTION spliit_touch_group_from_ledger_id_from_id();

-- Expense-owned rows: resolve the group through the expense.
CREATE OR REPLACE FUNCTION spliit_touch_group_from_expense_id()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM spliit_touch_groups_for_expense(OLD."expenseId");
    RETURN NULL;
  END IF;
  PERFORM spliit_touch_groups_for_expense(NEW."expenseId");
  IF TG_OP = 'UPDATE' AND NEW."expenseId" IS DISTINCT FROM OLD."expenseId" THEN
    PERFORM spliit_touch_groups_for_expense(OLD."expenseId");
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS spliit_offline_rev_paidby ON "ExpensePaidBy";
CREATE TRIGGER spliit_offline_rev_paidby
AFTER INSERT OR UPDATE OR DELETE ON "ExpensePaidBy"
FOR EACH ROW EXECUTE FUNCTION spliit_touch_group_from_expense_id();

DROP TRIGGER IF EXISTS spliit_offline_rev_paidfor ON "ExpensePaidFor";
CREATE TRIGGER spliit_offline_rev_paidfor
AFTER INSERT OR UPDATE OR DELETE ON "ExpensePaidFor"
FOR EACH ROW EXECUTE FUNCTION spliit_touch_group_from_expense_id();

DROP TRIGGER IF EXISTS spliit_offline_rev_item ON "ExpenseItem";
CREATE TRIGGER spliit_offline_rev_item
AFTER INSERT OR UPDATE OR DELETE ON "ExpenseItem"
FOR EACH ROW EXECUTE FUNCTION spliit_touch_group_from_expense_id();

DROP TRIGGER IF EXISTS spliit_offline_rev_remainder ON "ExpenseItemizedRemainder";
CREATE TRIGGER spliit_offline_rev_remainder
AFTER INSERT OR UPDATE OR DELETE ON "ExpenseItemizedRemainder"
FOR EACH ROW EXECUTE FUNCTION spliit_touch_group_from_expense_id();

DROP TRIGGER IF EXISTS spliit_offline_rev_remainder_paidfor ON "ExpenseItemizedRemainderPaidFor";
CREATE TRIGGER spliit_offline_rev_remainder_paidfor
AFTER INSERT OR UPDATE OR DELETE ON "ExpenseItemizedRemainderPaidFor"
FOR EACH ROW EXECUTE FUNCTION spliit_touch_group_from_expense_id();

DROP TRIGGER IF EXISTS spliit_offline_rev_import_source ON "ExpenseFileImportSource";
CREATE TRIGGER spliit_offline_rev_import_source
AFTER INSERT OR UPDATE OR DELETE ON "ExpenseFileImportSource"
FOR EACH ROW EXECUTE FUNCTION spliit_touch_group_from_expense_id();

-- Item-level shares resolve through ExpenseItem -> Expense.
CREATE OR REPLACE FUNCTION spliit_touch_group_from_item_id()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM spliit_touch_groups_for_expense(
      (SELECT "expenseId" FROM "ExpenseItem" WHERE id = OLD."expenseItemId")
    );
    RETURN NULL;
  END IF;
  PERFORM spliit_touch_groups_for_expense(
    (SELECT "expenseId" FROM "ExpenseItem" WHERE id = NEW."expenseItemId")
  );
  IF TG_OP = 'UPDATE' AND NEW."expenseItemId" IS DISTINCT FROM OLD."expenseItemId" THEN
    PERFORM spliit_touch_groups_for_expense(
      (SELECT "expenseId" FROM "ExpenseItem" WHERE id = OLD."expenseItemId")
    );
  END IF;
  RETURN NULL;
END;
$$;

-- Note: on DELETE the parent ExpenseItem row may already be gone (cascade
-- order); the subselect then yields NULL and the helper bumps nothing. The
-- cascade-deleted item row itself fires its own trigger first, so the group
-- is still bumped exactly when content disappears.
DROP TRIGGER IF EXISTS spliit_offline_rev_item_paidfor ON "ExpenseItemPaidFor";
CREATE TRIGGER spliit_offline_rev_item_paidfor
AFTER INSERT OR UPDATE OR DELETE ON "ExpenseItemPaidFor"
FOR EACH ROW EXECUTE FUNCTION spliit_touch_group_from_item_id();

-- Subgroup membership resolves through Subgroup -> Group.
CREATE OR REPLACE FUNCTION spliit_touch_group_from_subgroup_id()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM spliit_touch_group_offline_revision(
      (SELECT "groupId" FROM "Subgroup" WHERE id = OLD."subgroupId")
    );
    RETURN NULL;
  END IF;
  PERFORM spliit_touch_group_offline_revision(
    (SELECT "groupId" FROM "Subgroup" WHERE id = NEW."subgroupId")
  );
  IF TG_OP = 'UPDATE' AND NEW."subgroupId" IS DISTINCT FROM OLD."subgroupId" THEN
    PERFORM spliit_touch_group_offline_revision(
      (SELECT "groupId" FROM "Subgroup" WHERE id = OLD."subgroupId")
    );
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS spliit_offline_rev_subgroup_member ON "SubgroupMember";
CREATE TRIGGER spliit_offline_rev_subgroup_member
AFTER INSERT OR UPDATE OR DELETE ON "SubgroupMember"
FOR EACH ROW EXECUTE FUNCTION spliit_touch_group_from_subgroup_id();

-- Preset participants resolve through SplitPreset -> Group.
CREATE OR REPLACE FUNCTION spliit_touch_group_from_preset_id()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM spliit_touch_group_offline_revision(
      (SELECT "groupId" FROM "SplitPreset" WHERE id = OLD."presetId")
    );
    RETURN NULL;
  END IF;
  PERFORM spliit_touch_group_offline_revision(
    (SELECT "groupId" FROM "SplitPreset" WHERE id = NEW."presetId")
  );
  IF TG_OP = 'UPDATE' AND NEW."presetId" IS DISTINCT FROM OLD."presetId" THEN
    PERFORM spliit_touch_group_offline_revision(
      (SELECT "groupId" FROM "SplitPreset" WHERE id = OLD."presetId")
    );
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS spliit_offline_rev_preset_participant ON "SplitPresetParticipant";
CREATE TRIGGER spliit_offline_rev_preset_participant
AFTER INSERT OR UPDATE OR DELETE ON "SplitPresetParticipant"
FOR EACH ROW EXECUTE FUNCTION spliit_touch_group_from_preset_id();

-- Documents attach to an expense (preferred) or directly to a ledger.
CREATE OR REPLACE FUNCTION spliit_touch_group_from_document()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_expense_id TEXT;
  v_ledger_id TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_expense_id := OLD."expenseId";
    v_ledger_id := OLD."ledgerId";
  ELSE
    v_expense_id := NEW."expenseId";
    v_ledger_id := NEW."ledgerId";
  END IF;
  IF v_expense_id IS NOT NULL THEN
    PERFORM spliit_touch_groups_for_expense(v_expense_id);
  ELSE
    PERFORM spliit_touch_groups_for_ledger(v_ledger_id);
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW."expenseId" IS DISTINCT FROM OLD."expenseId" OR
    (NEW."expenseId" IS NULL AND NEW."ledgerId" IS DISTINCT FROM OLD."ledgerId")
  ) THEN
    IF OLD."expenseId" IS NOT NULL THEN
      PERFORM spliit_touch_groups_for_expense(OLD."expenseId");
    ELSE
      PERFORM spliit_touch_groups_for_ledger(OLD."ledgerId");
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS spliit_offline_rev_document ON "ExpenseDocument";
CREATE TRIGGER spliit_offline_rev_document
AFTER INSERT OR UPDATE OR DELETE ON "ExpenseDocument"
FOR EACH ROW EXECUTE FUNCTION spliit_touch_group_from_document();

-- Referenced account display data (User model maps to the Account table):
-- a name/image change is visible in every ACTIVE membership group.
CREATE OR REPLACE FUNCTION spliit_touch_groups_for_account()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "Group" g
  SET "offlineContentRevision" = g."offlineContentRevision" + 1
  FROM "GroupMember" m
  WHERE m."accountId" = NEW.id AND m.status = 'ACTIVE' AND g.id = m."groupId";
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS spliit_offline_rev_account ON "Account";
CREATE TRIGGER spliit_offline_rev_account
AFTER UPDATE ON "Account"
FOR EACH ROW
WHEN (OLD.name IS DISTINCT FROM NEW.name OR OLD.image IS DISTINCT FROM NEW.image)
EXECUTE FUNCTION spliit_touch_groups_for_account();

-- v2 additions: budgets, budget alerts, comments, feed activities.

-- GroupBudget carries a direct groupId, like GroupMember/Subgroup/SplitPreset.
DROP TRIGGER IF EXISTS spliit_offline_rev_budget ON "GroupBudget";
CREATE TRIGGER spliit_offline_rev_budget
AFTER INSERT OR UPDATE OR DELETE ON "GroupBudget"
FOR EACH ROW EXECUTE FUNCTION spliit_touch_group_from_group_id();

-- Alerts resolve through their budget. A cascade delete of a budget's alerts
-- fires this once per alert row plus the budget trigger once for the budget
-- row itself; clients refetch on any movement, so over-bumping stays safe.
CREATE OR REPLACE FUNCTION spliit_touch_group_from_budget_id()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_group_id TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT "groupId" INTO v_group_id FROM "GroupBudget" WHERE id = OLD."budgetId";
  ELSE
    SELECT "groupId" INTO v_group_id FROM "GroupBudget" WHERE id = NEW."budgetId";
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."budgetId" IS DISTINCT FROM OLD."budgetId" THEN
    SELECT "groupId" INTO v_group_id FROM "GroupBudget" WHERE id = OLD."budgetId";
    IF v_group_id IS NOT NULL THEN
      PERFORM spliit_touch_group_offline_revision(v_group_id);
    END IF;
    SELECT "groupId" INTO v_group_id FROM "GroupBudget" WHERE id = NEW."budgetId";
  END IF;
  IF v_group_id IS NOT NULL THEN
    PERFORM spliit_touch_group_offline_revision(v_group_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS spliit_offline_rev_budget_alert ON "GroupBudgetAlert";
CREATE TRIGGER spliit_offline_rev_budget_alert
AFTER INSERT OR UPDATE OR DELETE ON "GroupBudgetAlert"
FOR EACH ROW EXECUTE FUNCTION spliit_touch_group_from_budget_id();

-- Expense-owned rows reuse the expense resolver.
DROP TRIGGER IF EXISTS spliit_offline_rev_comment ON "ExpenseComment";
CREATE TRIGGER spliit_offline_rev_comment
AFTER INSERT OR UPDATE OR DELETE ON "ExpenseComment"
FOR EACH ROW EXECUTE FUNCTION spliit_touch_group_from_expense_id();

-- Feed activities resolve through their ledger.
DROP TRIGGER IF EXISTS spliit_offline_rev_activity ON "Activity";
CREATE TRIGGER spliit_offline_rev_activity
AFTER INSERT OR UPDATE OR DELETE ON "Activity"
FOR EACH ROW EXECUTE FUNCTION spliit_touch_group_from_ledger_id();

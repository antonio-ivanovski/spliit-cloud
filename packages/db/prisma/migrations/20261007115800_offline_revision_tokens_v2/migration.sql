-- Offline revision tokens for read-only offline contract v2.
--
-- Extends the trigger coverage from `offline_revision_tokens` to the tables
-- projected into the v2 snapshot payloads: ExpenseComment (full history inside
-- expense details), GroupBudget plus GroupBudgetAlert (budgets with
-- server-computed summaries), and Activity (recent feed window). Clients
-- compare the composed token (contract version + content revision + viewer
-- revision) to skip unchanged histories without refetching them.
--
-- Over-bump policy matches the base migration: dependent triggers fire on any
-- INSERT/UPDATE/DELETE rather than an enumerated column list, so a future
-- column that lands in the offline projection can never silently miss a bump
-- (the failure mode that would serve stale data as confirmed). The cost is an
-- occasional redundant refetch. Revision-only writes issued by these triggers
-- are recognised by `spliit_group_revision_self` so they are not counted
-- twice.

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

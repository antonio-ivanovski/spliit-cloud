-- Settle flagged reimbursements onto the new settlement category, then drop
-- the boolean. Ordinary Payment expenses (flag false) stay on payment.

UPDATE "Expense"
SET "categoryId" = 'settlement'
WHERE "isReimbursement" = true;

UPDATE "RecurringExpenseSeries"
SET "template" = CASE
  WHEN COALESCE(("template"->>'isReimbursement')::boolean, false)
    THEN ("template"::jsonb - 'isReimbursement') || '{"categoryId":"settlement"}'::jsonb
  ELSE "template"::jsonb - 'isReimbursement'
END;

ALTER TABLE "Expense" DROP COLUMN "isReimbursement";

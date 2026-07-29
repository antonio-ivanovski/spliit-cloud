CREATE INDEX "ExpensePaidFor_ledgerParticipantId_idx" ON "ExpensePaidFor"("ledgerParticipantId");

CREATE INDEX "Expense_ledgerId_createdAt_idx" ON "Expense"("ledgerId", "createdAt");

CREATE INDEX "Expense_ledgerId_amount_idx" ON "Expense"("ledgerId", "amount");

CREATE INDEX "GroupMember_accountId_status_idx" ON "GroupMember"("accountId", "status");

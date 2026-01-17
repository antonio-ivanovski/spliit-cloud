# Spliit Pending Test Implementation Tasks

## 1. Integration Tests (Jest)

### Recurring Expense Logic

_Location: `src/lib/api.test.ts`_

| Status  | Priority  | Task                                 | Implementation Guide                                                                                  |
| :------ | :-------- | :----------------------------------- | :---------------------------------------------------------------------------------------------------- |
| ✅ Done | 🔴 **P0** | **Create daily recurring expense**   | Verify `createRecurringExpenses` creates correct number of instances for daily interval. Mock DB.     |
| ✅ Done | 🔴 **P0** | **Create weekly recurring expense**  | Verify correct dates are generated for weekly interval (e.g., every Monday).                          |
| ⬜ Todo | 🔴 **P0** | **Create monthly recurring expense** | Verify correct dates for monthly interval.                                                            |
| ✅ Done | 🟡 **P1** | **Handle month boundaries**          | Test edge cases like Jan 31st → Feb 28/29, Mar 31st. Ensure dates don't skip or error.                |
| ⬜ Todo | 🔴 **P0** | **Stop recurrence correctly**        | Verify logic respects `endDate` or occurrence count limits.                                           |
| ⬜ Todo | 🟡 **P1** | **Use transactions**                 | Verify DB operations are wrapped in a transaction (mock `$transaction` and ensure rollback on error). |
| ⬜ Todo | 🟡 **P1** | **Payload: Daily**                   | Unit test `createPayloadForNewRecurringExpenseLink` returns correct next date for daily.              |
| ⬜ Todo | 🟡 **P1** | **Payload: Weekly**                  | Unit test payload generation for weekly interval.                                                     |
| ⬜ Todo | 🟡 **P1** | **Payload: Monthly**                 | Unit test payload generation for monthly interval.                                                    |

### Activity Logging

_Location: `src/lib/api.test.ts`_

| Status  | Priority  | Task                     | Implementation Guide                                                              |
| :------ | :-------- | :----------------------- | :-------------------------------------------------------------------------------- |
| ⬜ Todo | 🟡 **P1** | **Log CREATE_EXPENSE**   | Call `logActivity` with 'create' action. Assert DB insert with correct JSON data. |
| ⬜ Todo | 🟡 **P1** | **Log UPDATE_EXPENSE**   | Call with 'update' action. Assert DB insert includes diff or new state.           |
| ⬜ Todo | 🟡 **P1** | **Log DELETE_EXPENSE**   | Call with 'delete' action. Assert DB insert.                                      |
| ⬜ Todo | 🟡 **P1** | **Log UPDATE_GROUP**     | Call with 'update' action for group changes. Assert DB insert.                    |
| ⬜ Todo | 🟢 **P2** | **Store Participant ID** | Verify `participantId` column is correctly populated in Activity table.           |
| ⬜ Todo | 🟢 **P2** | **Store Expense Data**   | Verify `data` column contains valid JSON snapshot of the expense.                 |

---

## 2. E2E Tests (Playwright)

### Group & Expense Management

_Location: `tests/e2e/group-management.spec.ts` / `expense-crud.spec.ts`_

| Status  | Priority  | Task                          | Implementation Guide                                                                       |
| :------ | :-------- | :---------------------------- | :----------------------------------------------------------------------------------------- |
| ⬜ Todo | 🟢 **P2** | **Recent groups persistence** | Visit a group, go home, reload page. Assert group appears in "Recent" list (LocalStorage). |
| ⬜ Todo | 🟡 **P1** | **List pagination**           | Seed 20+ expenses. Verify "Load More" or infinite scroll loads subsequent items.           |
| ✅ Done | 🟡 **P1** | **List text filter**          | Type unique string in search bar. Assert only matching expenses are visible.               |

### Recurring Expenses Flow

_Location: `tests/e2e/recurring-expenses.spec.ts`_

| Status                                                                          | Priority  | Task                         | Implementation Guide                                                                                      |
| :------------------------------------------------------------------------------ | :-------- | :--------------------------- | :-------------------------------------------------------------------------------------------------------- |
| ✅ Done                                                                         | 🔴 **P0** | **Create daily recurring**   | Fill expense form, select "Daily". Submit. Verify generic recurring indicator UI.                         |
| ✅ Done                                                                         | 🔴 **P0** | **Create weekly recurring**  | Fill form, select "Weekly". Submit. Verify UI.                                                            |
| ✅ Done                                                                         | 🔴 **P0** | **Create monthly recurring** | Fill form, select "Monthly". Submit. Verify UI.                                                           |
| ✅ Done                                                                         | 🔴 **P0** | **Verify instances created** | (Complex) Create recurring expense. Trigger backend job or mock time. Verify new expense appears in list. |
| ⬜ Missing feature https://github.com/spliit-app/spliit/issues/492, do not test | 🟡 **P1** | **Edit stops future**        | Edit a recurring instance. Assert future instances are unlinked or modified according to logic.           |
| ✅ Done                                                                         | 🟡 **P1** | **Delete current only**      | Delete a recurring instance. Assert other instances in the chain remain.                                  |

### Statistics & Export

_Location: `tests/e2e/statistics.spec.ts` / `export.spec.ts`_

| Status  | Priority  | Task                     | Implementation Guide                                                     |
| :------ | :-------- | :----------------------- | :----------------------------------------------------------------------- |
| ✅ Done | 🔴 **P0** | **Verify Group Total**   | Sum expenses in list. Assert Stats page "Total Group Spending" matches.  |
| ✅ Done | 🔴 **P0** | **Verify User Paid**     | Assert "You Paid" matches sum of active user's payments.                 |
| ✅ Done | 🔴 **P0** | **Verify User Share**    | Assert "Your Share" matches sum of active user's splits.                 |
| ✅ Done | 🟡 **P1** | **Export JSON download** | Click JSON export. Wait for download event. Assert filename/extension.   |
| ✅ Done | 🟡 **P1** | **Export JSON content**  | Read downloaded JSON. Assert it contains valid array of expense objects. |
| ✅ Done | 🟡 **P1** | **Export CSV download**  | Click CSV export. Wait for download event.                               |
| ✅ Done | 🟡 **P1** | **Export CSV format**    | Read downloaded CSV. Assert headers and row data match expenses.         |

### Active User & Activity

_Location: `tests/e2e/active-user.spec.ts` / `activity-log.spec.ts`_

| Status  | Priority  | Task                   | Implementation Guide                                                        |
| :------ | :-------- | :--------------------- | :-------------------------------------------------------------------------- |
| ✅ Done | 🟡 **P1** | **Selection persists** | Select user. Reload page. Assert user is still selected (LocalStorage).     |
| ✅ Done | 🔴 **P0** | **Updates stats**      | Change active user. Assert Stats page numbers update to reflect new user.   |
| ✅ Done | 🟢 **P2** | **Log shows create**   | Create expense. Go to Activity. Assert "Created expense X" entry exists.    |
| ⬜ Todo | 🟢 **P2** | **Log shows update**   | Edit expense. Go to Activity. Assert "Updated expense X" entry exists.      |
| ⬜ Todo | 🟢 **P2** | **Log shows delete**   | Delete expense. Go to Activity. Assert "Deleted expense X" entry exists.    |
| ⬜ Todo | 🟢 **P2** | **Log pagination**     | Generate many activities. Verify pagination controls work on Activity page. |

### System & UI

_Location: `tests/e2e/ui.spec.ts`_

| Status  | Priority  | Task                     | Implementation Guide                                                   |
| :------ | :-------- | :----------------------- | :--------------------------------------------------------------------- |
| ⬜ Todo | 🟢 **P2** | **i18n UI updates**      | Switch lang to Spanish. Assert static text (headers/buttons) changes.  |
| ⬜ Todo | 🟡 **P1** | **i18n Currency format** | Switch lang/locale. Assert currency symbol position (€10 vs 10€).      |
| ⬜ Todo | 🟡 **P1** | **i18n Date format**     | Switch lang. Assert date format changes (MM/DD vs DD/MM).              |
| ⬜ Todo | 🟡 **P1** | **Mobile responsive**    | Set viewport to mobile. Assert drawer menu works instead of sidebar.   |
| ⬜ Todo | 🟡 **P1** | **Desktop responsive**   | Set viewport to desktop. Assert dialogs/sidebar appear correctly.      |
| ⬜ Todo | 🟡 **P1** | **Health Readiness**     | Fetch `/api/health/readiness`. Assert status 200 (database connected). |

### Document Upload (If Enabled)

_Location: `tests/e2e/documents.spec.ts`_

| Status  | Priority  | Task                 | Implementation Guide                                              |
| :------ | :-------- | :------------------- | :---------------------------------------------------------------- |
| ⬜ Todo | 🟡 **P1** | **Upload document**  | Mock S3. Upload file in expense form. Verify UI shows attachment. |
| ⬜ Todo | 🟢 **P2** | **Multiple docs**    | Upload multiple files. Verify all are listed.                     |
| ⬜ Todo | 🟡 **P1** | **Display document** | Click attached image. Verify lightbox/preview opens.              |

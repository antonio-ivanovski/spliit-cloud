# Spliit Test Plan

This document provides a comprehensive testing strategy for the Spliit expense-splitting application. Tests are categorized by type (Jest unit/integration tests vs Playwright E2E tests), priority, complexity, and implementation effort.

## Legend

**Priority Levels:**

- 🔴 **P0 (Critical)**: Core functionality, must have
- 🟡 **P1 (High)**: Important features, should have
- 🟢 **P2 (Medium)**: Nice to have, can defer
- 🔵 **P3 (Low)**: Edge cases, optional

**Complexity:**

- 🟢 **Low**: Simple, straightforward tests
- 🟡 **Medium**: Moderate setup or logic required
- 🔴 **High**: Complex scenarios, multiple dependencies

**Effort:**

- 🍏 **Low Hanging Fruit**: Easy wins, test immediately
- 🍊 **Medium Effort**: Reasonable investment
- 🍎 **High Effort**: Significant time investment

---

## 1. JEST UNIT TESTS (Business Logic)

These tests focus on pure business logic functions in `src/lib/` that are critical to the application's correctness. No external dependencies, fast execution.

### 1.1 Balance Calculations (`src/lib/balances.ts`)

| Test Case                                                   | Priority | Complexity | Effort  | Notes                                           |
| ----------------------------------------------------------- | -------- | ---------- | ------- | ----------------------------------------------- |
| `getBalances()` - evenly split expenses                     | 🔴 P0    | 🟢 Low     | ✅ Done | Critical - verify equal splits work correctly   |
| `getBalances()` - BY_SHARES split mode                      | 🔴 P0    | 🟡 Medium  | ✅ Done | Test weighted splits (1:2:3 ratios)             |
| `getBalances()` - BY_PERCENTAGE split mode                  | 🔴 P0    | 🟡 Medium  | ✅ Done | Test percentage splits summing to 100%          |
| `getBalances()` - BY_AMOUNT split mode                      | 🔴 P0    | 🟡 Medium  | ✅ Done | Test specific amounts per person                |
| `getBalances()` - handles rounding correctly                | 🟡 P1    | 🟡 Medium  | ✅ Done | Verify no floating point errors, totals balance |
| `getBalances()` - avoids negative zeros                     | 🟡 P1    | 🟢 Low     | ✅ Done | Check for `-0` values being normalized to `0`   |
| `getBalances()` - multiple participants, mixed expenses     | 🔴 P0    | 🟡 Medium  | ✅ Done | Integration test with realistic scenario        |
| `getBalances()` - last participant gets remaining amount    | 🔴 P0    | 🟡 Medium  | ✅ Done | Verify remainder distribution logic             |
| `getBalances()` - handles empty expense list                | 🟢 P2    | 🟢 Low     | ✅ Done | Edge case - empty array                         |
| `getBalances()` - single expense, single participant        | 🟢 P2    | 🟢 Low     | ✅ Done | Edge case - simplest scenario                   |
| `getSuggestedReimbursements()` - minimizes transactions     | 🔴 P0    | 🟡 Medium  | ✅ Done | Core feature - verify greedy algorithm works    |
| `getSuggestedReimbursements()` - stable sorting             | 🟡 P1    | 🟡 Medium  | ✅ Done | Verify same balances yield same suggestions     |
| `getSuggestedReimbursements()` - filters zero amounts       | 🟡 P1    | 🟢 Low     | ✅ Done | Ensure zero-value reimbursements excluded       |
| `getSuggestedReimbursements()` - handles balanced group     | 🟢 P2    | 🟢 Low     | ✅ Done | Edge case - all balances zero                   |
| `getSuggestedReimbursements()` - complex 5+ person scenario | 🟡 P1    | 🔴 High    | ✅ Done | Realistic multi-person settlement               |
| `getPublicBalances()` - converts reimbursements to balances | 🟡 P1    | 🟢 Low     | ✅ Done | Test reimbursement → balance conversion         |
| `compareBalancesForReimbursements()` - sorts correctly      | 🟡 P1    | 🟢 Low     | ✅ Done | Verify sorting logic (positive before negative) |

**Total: 17 tests | P0: 6, P1: 8, P2: 3 | Low effort: 11, Medium: 5, High: 1**

---

### 1.2 Totals & Statistics (`src/lib/totals.ts`)

| Test Case                                                    | Priority | Complexity | Effort  | Notes                                     |
| ------------------------------------------------------------ | -------- | ---------- | ------- | ----------------------------------------- |
| `getTotalGroupSpending()` - sums all expenses                | 🔴 P0    | 🟢 Low     | ✅ Done | Core metric calculation                   |
| `getTotalGroupSpending()` - excludes reimbursements          | 🔴 P0    | 🟢 Low     | ✅ Done | Critical - reimbursements shouldn't count |
| `getTotalGroupSpending()` - handles empty array              | 🟢 P2    | 🟢 Low     | ✅ Done | Edge case                                 |
| `getTotalActiveUserPaidFor()` - sums user's payments         | 🔴 P0    | 🟢 Low     | ✅ Done | Personalization feature                   |
| `getTotalActiveUserPaidFor()` - excludes reimbursements      | 🔴 P0    | 🟢 Low     | ✅ Done | Consistency with group total              |
| `getTotalActiveUserPaidFor()` - returns 0 for null user      | 🟡 P1    | 🟢 Low     | ✅ Done | Handle no active user case                |
| `calculateShare()` - EVENLY mode correct calculation         | 🔴 P0    | 🟢 Low     | ✅ Done | Core splitting logic                      |
| `calculateShare()` - BY_AMOUNT mode uses exact shares        | 🔴 P0    | 🟢 Low     | ✅ Done | Direct amount passthrough                 |
| `calculateShare()` - BY_PERCENTAGE mode (shares/10000)       | 🔴 P0    | 🟡 Medium  | ✅ Done | Percentage calculation with basis points  |
| `calculateShare()` - BY_SHARES weighted correctly            | 🔴 P0    | 🟡 Medium  | ✅ Done | Ratio-based splitting                     |
| `calculateShare()` - returns 0 for reimbursements            | 🔴 P0    | 🟢 Low     | ✅ Done | Reimbursement exclusion                   |
| `calculateShare()` - returns 0 if participant not in paidFor | 🟡 P1    | 🟢 Low     | ✅ Done | Participant not involved in expense       |
| `getTotalActiveUserShare()` - sums across expenses           | 🔴 P0    | 🟡 Medium  | ✅ Done | Total owed calculation                    |
| `getTotalActiveUserShare()` - rounds to 2 decimals           | 🟡 P1    | 🟢 Low     | ✅ Done | Currency precision handling               |

**Total: 14 tests | P0: 10, P1: 3, P2: 1 | Low effort: 14**

---

### 1.3 Currency Utilities (`src/lib/currency.ts`, `src/lib/utils.ts`)

| Test Case                                                 | Priority | Complexity | Effort  | Notes                           |
| --------------------------------------------------------- | -------- | ---------- | ------- | ------------------------------- |
| `formatCurrency()` - USD formatting (existing)            | 🔴 P0    | 🟢 Low     | ✅ Done | Already tested in utils.test.ts |
| `formatCurrency()` - EUR formatting (existing)            | 🔴 P0    | 🟢 Low     | ✅ Done | Already tested                  |
| `formatCurrency()` - custom currency symbols              | 🟡 P1    | 🟢 Low     | ✅ Done | Test non-ISO currency           |
| `formatCurrency()` - zero decimal currencies (JPY)        | 🟡 P1    | 🟢 Low     | ✅ Done | Test decimal_digits = 0         |
| `amountAsDecimal()` - converts cents to decimal           | 🔴 P0    | 🟢 Low     | ✅ Done | Core conversion                 |
| `amountAsDecimal()` - handles rounding when requested     | 🟡 P1    | 🟢 Low     | ✅ Done | Optional rounding param         |
| `amountAsMinorUnits()` - converts decimal to cents        | 🔴 P0    | 🟢 Low     | ✅ Done | Inverse of above                |
| `amountAsMinorUnits()` - rounds correctly                 | 🟡 P1    | 🟢 Low     | ✅ Done | No floating point issues        |
| `formatAmountAsDecimal()` - formats with correct decimals | 🟡 P1    | 🟢 Low     | ✅ Done | String formatting               |
| `getCurrency()` - returns currency by code                | 🔴 P0    | 🟢 Low     | ✅ Done | Lookup function                 |
| `getCurrency()` - returns custom for empty code           | 🟡 P1    | 🟢 Low     | ✅ Done | Fallback behavior               |
| `getCurrency()` - handles locale variations               | 🟢 P2    | 🟢 Low     | ✅ Done | i18n currency names             |
| `getCurrencyFromGroup()` - extracts from group object     | 🟡 P1    | 🟢 Low     | ✅ Done | Helper function                 |
| `defaultCurrencyList()` - includes custom currency        | 🟢 P2    | 🟢 Low     | ✅ Done | Custom currency in list         |

**Total: 14 tests | P0: 5, P1: 7, P2: 2 | Low effort: 12, Done: 2**

---

### 1.4 Utility Functions (`src/lib/utils.ts`)

| Test Case                                         | Priority | Complexity | Effort  | Notes                                  |
| ------------------------------------------------- | -------- | ---------- | ------- | -------------------------------------- |
| `formatDate()` - formats with locale              | 🟡 P1    | 🟢 Low     | ✅ Done | Date display                           |
| `formatDateOnly()` - avoids timezone shifts       | 🔴 P0    | 🟡 Medium  | ✅ Done | Critical for DATE fields, UTC handling |
| `formatDateOnly()` - handles month boundaries     | 🟡 P1    | 🟡 Medium  | ✅ Done | Edge case - dates near midnight        |
| `formatFileSize()` - formats bytes correctly      | 🟢 P2    | 🟢 Low     | ✅ Done | Utility function                       |
| `formatFileSize()` - handles GB, MB, KB, B units  | 🟢 P2    | 🟢 Low     | ✅ Done | Unit conversion                        |
| `normalizeString()` - removes accents             | 🟡 P1    | 🟢 Low     | ✅ Done | Search functionality                   |
| `normalizeString()` - lowercases                  | 🟡 P1    | 🟢 Low     | ✅ Done | Case-insensitive search                |
| `formatCategoryForAIPrompt()` - formats correctly | 🟢 P2    | 🟢 Low     | ✅ Done | AI feature helper                      |
| `delay()` - resolves after ms                     | 🔵 P3    | 🟢 Low     | ✅ Done | Simple utility                         |
| `cn()` - merges class names                       | 🔵 P3    | 🟢 Low     | ✅ Done | TailwindCSS helper                     |

**Total: 10 tests | P0: 1, P1: 4, P2: 3, P3: 2 | Low effort: 9, Medium: 1**

---

### 1.5 Schemas & Validation (`src/lib/schemas.ts`)

| Test Case                                               | Priority | Complexity | Effort  | Notes                |
| ------------------------------------------------------- | -------- | ---------- | ------- | -------------------- |
| `expenseFormSchema` - validates required fields         | 🔴 P0    | 🟢 Low     | ✅ Done | Form validation      |
| `expenseFormSchema` - rejects invalid split mode        | 🔴 P0    | 🟢 Low     | ✅ Done | Enum validation      |
| `expenseFormSchema` - validates percentage sums to 100% | 🔴 P0    | 🟡 Medium  | ✅ Done | Business rule        |
| `expenseFormSchema` - validates amount sum equals total | 🔴 P0    | 🟡 Medium  | ✅ Done | BY_AMOUNT validation |
| `expenseFormSchema` - allows valid recurring rules      | 🟡 P1    | 🟢 Low     | ✅ Done | Enum validation      |
| `groupFormSchema` - validates group creation            | 🔴 P0    | 🟢 Low     | ✅ Done | Group validation     |
| `groupFormSchema` - requires at least 2 participants    | 🔴 P0    | 🟢 Low     | ✅ Done | Business rule        |
| `groupFormSchema` - validates currency format           | 🟡 P1    | 🟢 Low     | ✅ Done | Currency validation  |

**Total: 8 tests | P0: 6, P1: 2 | Low effort: 6, Medium: 2**

---

## 2. JEST INTEGRATION TESTS (API & Database)

These tests require database setup but test important business logic flows. Use test database or mocks.

### 2.1 Recurring Expense Logic (`src/lib/api.ts`)

| Test Case                                               | Priority | Complexity | Effort    | Notes                     |
| ------------------------------------------------------- | -------- | ---------- | --------- | ------------------------- |
| `createRecurringExpenses()` - creates daily recurring   | 🔴 P0    | 🔴 High    | 🍎 High   | Complex, requires DB      |
| `createRecurringExpenses()` - creates weekly recurring  | 🔴 P0    | 🔴 High    | 🍎 High   | Date arithmetic           |
| `createRecurringExpenses()` - creates monthly recurring | 🔴 P0    | 🔴 High    | 🍎 High   | Edge cases: 29-31st dates |
| `createRecurringExpenses()` - handles month boundaries  | 🟡 P1    | 🔴 High    | 🍎 High   | Feb 29, 30, 31 edge cases |
| `createRecurringExpenses()` - stops at correct time     | 🔴 P0    | 🟡 Medium  | 🍊 Medium | Verify loop termination   |
| `createRecurringExpenses()` - uses transactions         | 🟡 P1    | 🔴 High    | 🍎 High   | Race condition prevention |
| `createPayloadForNewRecurringExpenseLink()` - daily     | 🟡 P1    | 🟡 Medium  | 🍊 Medium | Payload generation        |
| `createPayloadForNewRecurringExpenseLink()` - weekly    | 🟡 P1    | 🟡 Medium  | 🍊 Medium | Payload generation        |
| `createPayloadForNewRecurringExpenseLink()` - monthly   | 🟡 P1    | 🟡 Medium  | 🍊 Medium | Payload generation        |

**Total: 9 tests | P0: 4, P1: 5 | Medium: 3, High: 6**

⚠️ **Note**: These are complex and require careful DB setup. Consider mocking Prisma for faster tests.

---

### 2.2 Activity Logging (`src/lib/api.ts`)

| Test Case                               | Priority | Complexity | Effort    | Notes            |
| --------------------------------------- | -------- | ---------- | --------- | ---------------- |
| `logActivity()` - logs CREATE_EXPENSE   | 🟡 P1    | 🟡 Medium  | 🍊 Medium | Audit trail      |
| `logActivity()` - logs UPDATE_EXPENSE   | 🟡 P1    | 🟡 Medium  | 🍊 Medium | Audit trail      |
| `logActivity()` - logs DELETE_EXPENSE   | 🟡 P1    | 🟡 Medium  | 🍊 Medium | Audit trail      |
| `logActivity()` - logs UPDATE_GROUP     | 🟡 P1    | 🟡 Medium  | 🍊 Medium | Audit trail      |
| `logActivity()` - stores participant ID | 🟢 P2    | 🟡 Medium  | 🍊 Medium | User tracking    |
| `logActivity()` - stores expense data   | 🟢 P2    | 🟡 Medium  | 🍊 Medium | Metadata storage |

**Total: 6 tests | P1: 4, P2: 2 | Medium: 6**

---

## 3. PLAYWRIGHT E2E TESTS

These tests verify user-facing functionality through the browser. Focus on critical user journeys.

### 3.1 Group Management Flows

| Test Case                           | Priority | Complexity | Effort    | Notes                     |
| ----------------------------------- | -------- | ---------- | --------- | ------------------------- |
| Create group - happy path           | 🔴 P0    | 🟢 Low     | ✅ Done   | Core user flow            |
| Create group - with custom currency | 🟡 P1    | 🟢 Low     | ✅ Done   | Custom currency selection |
| Create group - validation errors    | 🟡 P1    | 🟡 Medium  | ✅ Done   | Form validation           |
| Edit group - update name and info   | 🟡 P1    | 🟢 Low     | ✅ Done   | Edit flow                 |
| Edit group - add participant        | 🔴 P0    | 🟡 Medium  | ✅ Done   | Important feature         |
| Edit group - remove participant     | 🟡 P1    | 🟡 Medium  | ✅ Done   | Important feature         |
| Edit group - rename participant     | 🟢 P2    | 🟢 Low     | 🍏 Low    | Edit participant          |
| View group information page         | 🟢 P2    | 🟢 Low     | ✅ Done   | Read-only view            |
| Share group - copy URL              | 🟡 P1    | 🟡 Medium  | ✅ Done   | Collaboration feature     |
| Recent groups list - persists       | 🟢 P2    | 🟡 Medium  | 🍊 Medium | LocalStorage test         |
| Navigate between groups             | 🟢 P2    | 🟢 Low     | 🍏 Low    | Navigation                |

**Total: 11 tests | P0: 2, P1: 5, P2: 4 | Low effort: 6, Medium: 5**

---

### 3.2 Expense Management Flows

| Test Case                                 | Priority | Complexity | Effort    | Notes                |
| ----------------------------------------- | -------- | ---------- | --------- | -------------------- |
| Create expense - evenly split             | 🔴 P0    | 🟡 Medium  | ✅ Done   | Most common flow     |
| Create expense - by shares                | 🔴 P0    | 🟡 Medium  | ✅ Done   | Weighted split       |
| Create expense - by percentage            | 🔴 P0    | 🟡 Medium  | ✅ Done   | Percentage split     |
| Create expense - by amount                | 🔴 P0    | 🟡 Medium  | ✅ Done   | Specific amounts     |
| Create expense - with category            | 🟡 P1    | 🟢 Low     | 🍏 Low    | Category selection   |
| Create expense - with notes               | 🟢 P2    | 🟢 Low     | 🍏 Low    | Optional field       |
| Create expense - with custom date         | 🟡 P1    | 🟢 Low     | 🍏 Low    | Date picker          |
| Create expense - with currency conversion | 🟡 P1    | 🟡 Medium  | 🍊 Medium | Multi-currency       |
| Create expense - as reimbursement         | 🟡 P1    | 🟢 Low     | 🍏 Low    | Reimbursement flag   |
| Create expense - validation errors        | 🟡 P1    | 🟡 Medium  | 🍊 Medium | Form validation      |
| Edit expense - update all fields          | 🟡 P1    | 🟡 Medium  | 🍊 Medium | Edit flow            |
| Edit expense - change split mode          | 🟡 P1    | 🟡 Medium  | 🍊 Medium | Mode switching       |
| Delete expense - confirmation flow        | 🔴 P0    | 🟢 Low     | ✅ Done   | Deletion             |
| List expenses - pagination                | 🟡 P1    | 🟡 Medium  | 🍊 Medium | Large lists          |
| List expenses - filter by text            | 🟡 P1    | 🟡 Medium  | 🍊 Medium | Search functionality |
| Expense displays correct date             | 🟡 P1    | 🟢 Low     | 🍏 Low    | Date rendering       |
| Expense displays correct amount           | 🔴 P0    | 🟢 Low     | ✅ Done   | Amount display       |
| Expense shows category                    | 🟢 P2    | 🟢 Low     | 🍏 Low    | Category display     |

**Total: 18 tests | P0: 4, P1: 11, P2: 3 | Low effort: 10, Medium: 8**

---

### 3.3 Recurring Expenses Flow

| Test Case                               | Priority | Complexity | Effort    | Notes                |
| --------------------------------------- | -------- | ---------- | --------- | -------------------- |
| Create daily recurring expense          | 🔴 P0    | 🟡 Medium  | 🍊 Medium | Core feature         |
| Create weekly recurring expense         | 🔴 P0    | 🟡 Medium  | 🍊 Medium | Core feature         |
| Create monthly recurring expense        | 🔴 P0    | 🟡 Medium  | 🍊 Medium | Core feature         |
| Verify recurring instances created      | 🔴 P0    | 🔴 High    | 🍎 High   | Time-based, complex  |
| Edit recurring expense - stops future   | 🟡 P1    | 🟡 Medium  | 🍊 Medium | Modification logic   |
| Delete recurring expense - only current | 🟡 P1    | 🟡 Medium  | 🍊 Medium | Independent deletion |
| Recurring expense shows indicator       | 🟢 P2    | 🟢 Low     | 🍏 Low    | UI element           |

**Total: 7 tests | P0: 4, P1: 2, P2: 1 | Low effort: 1, Medium: 4, High: 2**

---

### 3.4 Balance & Reimbursement Flows

| Test Case                                 | Priority | Complexity | Effort    | Notes                  |
| ----------------------------------------- | -------- | ---------- | --------- | ---------------------- |
| View balances page - calculates correctly | 🔴 P0    | 🟡 Medium  | 🍊 Medium | Core feature           |
| Balances match expected from expenses     | 🔴 P0    | 🟡 Medium  | 🍊 Medium | Verification test      |
| Suggested reimbursements displayed        | 🔴 P0    | 🟢 Low     | ✅ Done   | Suggestions shown      |
| Suggested reimbursements minimized        | 🟡 P1    | 🟡 Medium  | 🍊 Medium | Algorithm verification |
| Active user balance highlighted           | 🟡 P1    | 🟢 Low     | 🍏 Low    | Personalization        |
| Create reimbursement expense              | 🟡 P1    | 🟡 Medium  | 🍊 Medium | Settle debt flow       |
| Reimbursement excludes from totals        | 🔴 P0    | 🟡 Medium  | 🍊 Medium | Important logic        |
| Zero balances display correctly           | 🟢 P2    | 🟢 Low     | 🍏 Low    | Edge case              |

**Total: 8 tests | P0: 4, P1: 3, P2: 1 | Low effort: 4, Medium: 4**

---

### 3.5 Statistics & Export Flows

| Test Case                       | Priority | Complexity | Effort    | Notes                    |
| ------------------------------- | -------- | ---------- | --------- | ------------------------ |
| View statistics page            | 🟡 P1    | 🟢 Low     | 🍏 Low    | Stats display            |
| Total group spending correct    | 🔴 P0    | 🟡 Medium  | 🍊 Medium | Calculation verification |
| User total paid correct         | 🔴 P0    | 🟡 Medium  | 🍊 Medium | Personalization          |
| User total share correct        | 🔴 P0    | 🟡 Medium  | 🍊 Medium | Personalization          |
| Export to JSON - downloads file | 🟡 P1    | 🟡 Medium  | 🍊 Medium | Export functionality     |
| Export to JSON - correct data   | 🟡 P1    | 🟡 Medium  | 🍊 Medium | Data verification        |
| Export to CSV - downloads file  | 🟡 P1    | 🟡 Medium  | 🍊 Medium | Export functionality     |
| Export to CSV - correct format  | 🟡 P1    | 🟡 Medium  | 🍊 Medium | CSV structure            |

**Total: 8 tests | P0: 3, P1: 5 | Low effort: 1, Medium: 7**

---

### 3.6 Active User Selection

| Test Case                        | Priority | Complexity | Effort    | Notes             |
| -------------------------------- | -------- | ---------- | --------- | ----------------- |
| Select active user - persists    | 🟡 P1    | 🟡 Medium  | 🍊 Medium | LocalStorage test |
| Active user changes balance view | 🔴 P0    | 🟡 Medium  | 🍊 Medium | Personalization   |
| Active user changes stats        | 🔴 P0    | 🟡 Medium  | 🍊 Medium | Personalization   |
| Clear active user - neutral view | 🟢 P2    | 🟢 Low     | 🍏 Low    | Reset feature     |

**Total: 4 tests | P0: 2, P1: 1, P2: 1 | Low effort: 1, Medium: 3**

---

### 3.7 Activity Log

| Test Case                       | Priority | Complexity | Effort    | Notes         |
| ------------------------------- | -------- | ---------- | --------- | ------------- |
| View activity page              | 🟢 P2    | 🟢 Low     | 🍏 Low    | Activity list |
| Activity shows expense creation | 🟢 P2    | 🟡 Medium  | 🍊 Medium | Audit log     |
| Activity shows expense update   | 🟢 P2    | 🟡 Medium  | 🍊 Medium | Audit log     |
| Activity shows expense deletion | 🟢 P2    | 🟡 Medium  | 🍊 Medium | Audit log     |
| Activity pagination works       | 🟢 P2    | 🟡 Medium  | 🍊 Medium | Long lists    |

**Total: 5 tests | P2: 5 | Low effort: 1, Medium: 4**

---

### 3.8 Category Management

| Test Case                             | Priority | Complexity | Effort | Notes              |
| ------------------------------------- | -------- | ---------- | ------ | ------------------ |
| Select category when creating expense | 🟡 P1    | 🟢 Low     | 🍏 Low | Dropdown selection |
| Category displays on expense          | 🟡 P1    | 🟢 Low     | 🍏 Low | Display test       |
| Default category (General) selected   | 🟢 P2    | 🟢 Low     | 🍏 Low | Default behavior   |

**Total: 3 tests | P1: 2, P2: 1 | Low effort: 3**

---

### 3.9 Internationalization (i18n)

| Test Case                    | Priority | Complexity | Effort    | Notes             |
| ---------------------------- | -------- | ---------- | --------- | ----------------- |
| Change language - UI updates | 🟢 P2    | 🟡 Medium  | 🍊 Medium | i18n test         |
| Currency formats per locale  | 🟡 P1    | 🟡 Medium  | 🍊 Medium | Locale formatting |
| Date formats per locale      | 🟡 P1    | 🟡 Medium  | 🍊 Medium | Locale formatting |

**Total: 3 tests | P1: 2, P2: 1 | Medium: 3**

---

### 3.10 Theme & UI

| Test Case                         | Priority | Complexity | Effort    | Notes           |
| --------------------------------- | -------- | ---------- | --------- | --------------- |
| Toggle dark mode - persists       | 🟢 P2    | 🟢 Low     | 🍏 Low    | Theme switching |
| Mobile responsive - drawer opens  | 🟡 P1    | 🟡 Medium  | 🍊 Medium | Mobile testing  |
| Desktop responsive - dialog opens | 🟡 P1    | 🟡 Medium  | 🍊 Medium | Desktop testing |

**Total: 3 tests | P1: 2, P2: 1 | Low effort: 1, Medium: 2**

---

### 3.11 Document Upload (if S3 enabled)

| Test Case                     | Priority | Complexity | Effort  | Notes          |
| ----------------------------- | -------- | ---------- | ------- | -------------- |
| Upload document to expense    | 🟡 P1    | 🔴 High    | 🍎 High | S3 integration |
| Multiple documents on expense | 🟢 P2    | 🔴 High    | 🍎 High | S3 integration |
| Document displays in expense  | 🟡 P1    | 🔴 High    | 🍎 High | S3 integration |

**Total: 3 tests | P1: 2, P2: 1 | High: 3**

⚠️ **Note**: Requires S3 setup or mocking. Skip if feature flag disabled.

---

### 3.12 Health Endpoints

| Test Case                          | Priority | Complexity | Effort    | Notes        |
| ---------------------------------- | -------- | ---------- | --------- | ------------ |
| `/api/health/liveness` returns 200 | 🟡 P1    | 🟢 Low     | 🍏 Low    | Health check |
| `/api/health/readiness` checks DB  | 🟡 P1    | 🟡 Medium  | 🍊 Medium | DB health    |

**Total: 2 tests | P1: 2 | Low effort: 1, Medium: 1**

---

## 4. TEST PRIORITY SUMMARY

### Immediate Implementation (🍏 Low Hanging Fruit)

**Jest Unit Tests (High ROI, Fast):**

1. Balance calculations - all split modes (6 tests)
2. Total calculations - group and user totals (8 tests)
3. Currency conversion utilities (8 tests)
4. Schema validations (6 tests)

**Playwright E2E (Critical Paths):**

1. Create group happy path (1 test)
2. Create expense - evenly split (1 test)
3. Delete expense (1 test)
4. View balances (1 test)
5. Suggested reimbursements display (1 test)

**Estimated: ~30 tests, 2-3 days**

---

### Phase 2 (🍊 Medium Effort)

**Jest Unit Tests:**

1. Complex balance scenarios (4 tests)
2. Date handling edge cases (3 tests)
3. Schema validation edge cases (2 tests)

**Playwright E2E:**

1. All expense split modes (3 tests)
2. Edit flows (5 tests)
3. Currency conversion (2 tests)
4. Export functionality (4 tests)

**Estimated: ~23 tests, 3-4 days**

---

### Phase 3 (🍎 High Effort)

**Jest Integration Tests:**

1. Recurring expense creation logic (9 tests)
2. Activity logging (6 tests)

**Playwright E2E:**

1. Recurring expense flows (4 tests)
2. Document upload (if enabled) (3 tests)
3. Complex multi-user scenarios (3 tests)

**Estimated: ~25 tests, 5-7 days**

---

### Phase 4 (Nice to Have)

**Lower Priority Tests:**

1. Edge cases (P2/P3 tests)
2. UI/UX tests (theme, responsive)
3. i18n tests
4. Activity log tests

**Estimated: ~30 tests, 3-4 days**

---

## 5. TEST ORGANIZATION

### Recommended File Structure

```
├── src/
│   └── lib/
│       ├── balances.test.ts          # Balance calculation tests
│       ├── totals.test.ts            # Totals & statistics tests
│       ├── currency.test.ts          # Currency utilities tests
│       ├── utils.test.ts             # Utility functions tests (exists)
│       ├── schemas.test.ts           # Zod schema validation tests
│       └── api.test.ts               # API integration tests (requires DB)
├── tests/
│   ├── e2e/
│   │   ├── group-management.spec.ts
│   │   ├── expense-crud.spec.ts
│   │   ├── expense-split-modes.spec.ts
│   │   ├── recurring-expenses.spec.ts
│   │   ├── balances.spec.ts
│   │   ├── statistics.spec.ts
│   │   ├── active-user.spec.ts
│   │   ├── export.spec.ts
│   │   ├── activity-log.spec.ts
│   │   └── ui.spec.ts
│   └── fixtures/
│       ├── test-data.ts              # Shared test data
│       └── test-helpers.ts           # Helper functions
```

---

## 6. TESTING BEST PRACTICES

### Jest Best Practices

1. **Isolation**: Each test should be independent
2. **Naming**: Use descriptive test names - `it('should calculate evenly split for 3 participants')`
3. **Arrange-Act-Assert**: Structure tests clearly
4. **Test Data**: Use factories/fixtures for consistent test data
5. **Mock Sparingly**: Only mock external dependencies (DB, API calls)
6. **Fast**: Unit tests should run in milliseconds
7. **Coverage**: Aim for 80%+ coverage on business logic

### Playwright Best Practices

1. **Page Object Model**: Create page objects for reusable selectors
2. **Fixtures**: Use Playwright fixtures for setup/teardown
3. **Locators**: Use accessible selectors (role, label, text)
4. **Waits**: Use auto-waiting, avoid hard waits
5. **Assertions**: Use Playwright's expect for auto-retrying assertions
6. **Test Data**: Clean up test data after each run
7. **Parallel**: Run tests in parallel when possible (config already set to `fullyParallel: false` - consider enabling per test file)
8. **Screenshots**: Capture on failure for debugging
9. **Mobile**: Test both mobile and desktop viewports
10. **Network**: Mock external API calls (currency rates, OpenAI) for reliability

---

## 7. MOCK STRATEGIES

### What to Mock

**Jest Unit Tests:**

- ❌ Don't mock: Pure functions (balances, totals, currency)
- ✅ Mock: Prisma client for API tests
- ✅ Mock: External APIs (OpenAI, currency rates)

**Playwright E2E:**

- ❌ Don't mock: Database (use test DB)
- ✅ Mock: External APIs (OpenAI, Frankfurter currency API)
- ✅ Mock: S3 uploads (unless testing S3 feature)
- ✅ Mock: Email/notifications (if added)

### Test Database Strategy

For integration tests, use one of:

1. **SQLite in-memory**: Fast, no setup, but may have dialect differences
2. **PostgreSQL test container**: Realistic, requires Docker
3. **Prisma mocking**: Fast, but requires more setup

Recommendation: **PostgreSQL test container** for realism, or **Prisma mocking** for speed.

---

## 8. COVERAGE GOALS

### Target Coverage by Module

| Module                | Current | Target | Priority |
| --------------------- | ------- | ------ | -------- |
| `src/lib/balances.ts` | 0%      | 95%+   | 🔴 P0    |
| `src/lib/totals.ts`   | 0%      | 95%+   | 🔴 P0    |
| `src/lib/currency.ts` | 0%      | 90%+   | 🔴 P0    |
| `src/lib/utils.ts`    | ~30%    | 90%+   | 🟡 P1    |
| `src/lib/schemas.ts`  | 0%      | 80%+   | 🔴 P0    |
| `src/lib/api.ts`      | 0%      | 70%+   | 🟡 P1    |
| E2E Critical Paths    | 0%      | 100%   | 🔴 P0    |

---

## 9. IMPLEMENTATION ROADMAP

### Week 1: Foundation (🍏 Low Hanging Fruit)

- [ ] Setup Jest test structure
- [ ] Balance calculation tests (17 tests)
- [ ] Totals calculation tests (14 tests)
- [ ] Basic E2E flows (5 tests)
- **Deliverable**: ~36 tests, core logic validated

### Week 2: Expansion (🍊 Medium Effort)

- [ ] Currency & utils tests (14 tests)
- [ ] Schema validation tests (8 tests)
- [ ] Expense CRUD E2E (10 tests)
- [ ] Balance E2E verification (4 tests)
- **Deliverable**: ~36 tests, critical features covered

### Week 3: Advanced (🍎 High Effort)

- [ ] Recurring expense logic (9 tests)
- [ ] Activity logging (6 tests)
- [ ] Recurring E2E flows (7 tests)
- [ ] Export functionality (8 tests)
- **Deliverable**: ~30 tests, complex features validated

### Week 4: Polish & Edge Cases

- [ ] Edge case tests (P2/P3)
- [ ] UI/UX tests (6 tests)
- [ ] i18n tests (3 tests)
- [ ] Activity log E2E (5 tests)
- [ ] Documentation updates
- **Deliverable**: ~30 tests, comprehensive coverage

**Total Estimated**: ~130+ tests over 4 weeks

---

## 10. KEY RISKS & MITIGATIONS

| Risk                                     | Impact | Mitigation                                    |
| ---------------------------------------- | ------ | --------------------------------------------- |
| Recurring expense time-based tests flaky | High   | Use fixed dates, mock `Date.now()`            |
| Database setup complexity                | Medium | Use Docker Compose for test DB                |
| S3 tests require AWS setup               | Medium | Mock S3 or skip with feature flag check       |
| OpenAI API costs in tests                | Low    | Always mock AI features                       |
| Timezone issues in date tests            | High   | Use UTC, test `formatDateOnly()` thoroughly   |
| Test data cleanup                        | Medium | Use Playwright fixtures for automatic cleanup |
| Floating point rounding errors           | High   | Thoroughly test rounding in balances          |

---

## 11. SUCCESS METRICS

**Immediate (Week 1-2):**

- ✅ 80%+ coverage on `balances.ts`, `totals.ts`, `currency.ts`
- ✅ All P0 unit tests passing
- ✅ Basic E2E flow working (create group → create expense → view balance)

**Medium Term (Week 3-4):**

- ✅ 70%+ overall code coverage
- ✅ All P0 and P1 tests implemented
- ✅ CI/CD integration (tests run on PR)
- ✅ Test execution time < 5 minutes (unit + integration)
- ✅ E2E execution time < 10 minutes

**Long Term:**

- ✅ 80%+ overall code coverage
- ✅ All P0, P1, P2 tests implemented
- ✅ Zero flaky tests
- ✅ Test-driven development for new features

---

## 12. TOTAL TEST COUNT SUMMARY

| Category            | P0     | P1     | P2     | P3    | Total   | Low Effort | Med Effort | High Effort |
| ------------------- | ------ | ------ | ------ | ----- | ------- | ---------- | ---------- | ----------- |
| **Jest Unit Tests** | 37     | 22     | 6      | 2     | **67**  | 52         | 11         | 4           |
| **Playwright E2E**  | 23     | 38     | 16     | 0     | **77**  | 34         | 33         | 10          |
| **GRAND TOTAL**     | **60** | **60** | **22** | **2** | **144** | **86**     | **44**     | **14**      |

**Priority Breakdown:**

- 🔴 **P0 (Critical)**: 60 tests - Core functionality
- 🟡 **P1 (High)**: 60 tests - Important features
- 🟢 **P2 (Medium)**: 22 tests - Nice to have
- 🔵 **P3 (Low)**: 2 tests - Edge cases

**Effort Breakdown:**

- 🍏 **Low Hanging Fruit**: 86 tests (~60%) - Quick wins
- 🍊 **Medium Effort**: 44 tests (~31%) - Moderate investment
- 🍎 **High Effort**: 14 tests (~10%) - Complex scenarios

---

## Notes

- **No code changes needed**: All tests can be written against existing code
- **Fast & Simple**: Focus on pure unit tests first (balances, totals, currency)
- **Best Practices**: Follow Jest & Playwright conventions
- **Prioritized**: P0 tests are must-haves, P3 are optional
- **Realistic Estimates**: 130+ tests achievable in 4 weeks with 1 developer

This plan provides a clear roadmap from quick wins to comprehensive coverage without modifying application code.

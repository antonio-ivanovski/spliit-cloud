# Tasks: Refactor Composable Form Input Elements

1. **Create directory structure and base component**

   - Create `src/components/expense-form-fields/` directory
   - Create `expense-form-field.tsx` - base FormField wrapper with consistent label/description/message structure
   - Create `index.ts` - barrel exports for all components
   - Run TypeScript check: `npm check-types`

2. **Extract TitleInput component**

   - Create `src/components/expense-form-fields/title-input.tsx`
   - Extract title field logic (lines 452-482 from expense-form.tsx)
   - Preserve category extraction on blur behavior
   - Add props: `name`, `control`, `label`, `placeholder`, `onBlur`
   - Update expense-form.tsx to use new TitleInput
   - Verify title input works and category extraction still triggers

3. **Extract DateInput component**

   - Create `src/components/expense-form-fields/date-input.tsx`
   - Extract date picker logic (lines 484-506)
   - Add props: `name`, `control`, `label`, `value`, `onChange`
   - Update expense-form.tsx to use new DateInput
   - Verify date selection works

4. **Extract NotesInput component**

   - Create `src/components/expense-form-fields/notes-input.tsx`
   - Extract notes textarea logic (lines 759-770)
   - Add props: `name`, `control`, `label`
   - Update expense-form.tsx to use new NotesInput
   - Verify notes input works

5. **Extract PaidBySelector component**

   - Create `src/components/expense-form-fields/paid-by-selector.tsx`
   - Extract paid-by dropdown logic (lines 729-758)
   - Add props: `name`, `control`, `participants`, `label`, `placeholder`
   - Update expense-form.tsx to use new PaidBySelector
   - Verify payer selection works

6. **Extract RecurrenceRuleSelector component**

   - Create `src/components/expense-form-fields/recurrence-rule-selector.tsx`
   - Extract recurrence rule dropdown logic (lines 771-807)
   - Add props: `name`, `control`, `label`, `description`, `options`
   - Update expense-form.tsx to use new RecurrenceRuleSelector
   - Verify recurrence rule selection works

7. **Extract CategoryFormField component**

   - Create `src/components/expense-form-fields/category-form-field.tsx`
   - Wrap existing CategorySelector with FormField integration
   - Add props: `name`, `control`, `categories`, `label`, `description`, `isLoading`
   - Update expense-form.tsx to use new CategoryFormField
   - Verify category selection works with loading state

8. **Extract CurrencySelectorField component**

   - Create `src/components/expense-form-fields/currency-selector-field.tsx`
   - Wrap existing CurrencySelector with FormField integration
   - Add props: `name`, `control`, `currencies`, `label`, `description`, `groupCurrencyCode`
   - Update expense-form.tsx to use new CurrencySelectorField
   - Verify currency selection works

9. **Extract SplitModeSelector component**

   - Create `src/components/expense-form-fields/split-mode-selector.tsx`
   - Extract split mode dropdown logic (lines 1175-1191+)
   - Add props: `name`, `control`, `label`, `onValueChange`
   - Update expense-form.tsx to use new SplitModeSelector
   - Verify split mode selection works

10. **Extract AmountInput component**

    - Create `src/components/expense-form-fields/amount-input.tsx`
    - Extract amount field with currency symbol (lines 672-727)
    - Include income detection and reimbursement checkbox logic
    - Add props: `name`, `control`, `currencyCode`, `currencySymbol`, `label`, `onIncomeChange`
    - Apply `rerender-memo` pattern for expensive calculations
    - Update expense-form.tsx to use new AmountInput
    - Verify amount input, negative values, and reimbursement toggle work

11. **Extract PaidForField component (complex)**

    - Create `src/components/expense-form-fields/paid-for-field.tsx`
    - Extract complex participant shares editor (lines 811-1163+)
    - Include select all/none logic, participant rows, share inputs
    - Add props: `name`, `control`, `participants`, `splitMode`, `groupCurrency`, `conversionRequired`, `originalCurrency`, `onManuallyEdited`
    - Apply `rerender-memo` pattern to memoize participant rows
    - Apply `rerender-defer-reads` pattern - use `form.getValues()` in callbacks instead of `form.watch()`
    - Update expense-form.tsx to use new PaidForField
    - Verify participant selection, share editing, and split mode changes work

12. **Clean up expense-form.tsx**

    - Remove all inline FormField render functions that were extracted
    - Keep only form initialization, state management, and component composition
    - Verify imports are correct and unused imports are removed
    - Run TypeScript check: `npm check-types`
    - Run linter: `npm run lint`

13. **Run full test suite**

    - Run unit tests: `npm test`
    - Fix any failing unit tests
    - Run E2E tests: `npm run test-e2e`
    - Fix any failing E2E tests

14. **Manual verification**

    - Test creating an expense with all fields
    - Test editing an existing expense
    - Test currency conversion workflow
    - Test all split modes (EVENLY, BY_SHARES, BY_PERCENTAGE, BY_AMOUNT)
    - Test participant selection and share editing
    - Test reimbursement toggle and income detection
    - Test recurrence rule selection
    - Verify keyboard navigation and focus management

15. **Final validation**
    - Run TypeScript check: `npm check-types`
    - Run linter: `npm run lint`
    - Run unit tests: `npm test`
    - Run E2E tests: `npm run test-e2e`
    - Verify no console errors in browser

## Dependencies

Tasks 1-9 can be done in parallel by multiple developers if desired.
Tasks 10-11 must be done sequentially (Amount before PaidForField due to shared logic).
Tasks 12-15 must be done in sequence.

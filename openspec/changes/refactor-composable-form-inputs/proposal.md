# Refactor: Composable Form Input Elements

## Summary

Extract monolithic `ExpenseForm` component (~1300 lines) into composable, reusable form input components. This improves code maintainability, testability, and aligns with Vercel React best practices.

## Motivation

The current `expense-form.tsx` contains all form field logic inline, making it difficult to:

- Reuse form inputs in other contexts
- Test individual form fields in isolation
- Understand component behavior due to excessive cognitive load
- Apply performance optimizations like memoization at granular levels

## Goals

1. Extract reusable form input components for common expense form fields
2. Improve code organization and maintainability
3. Enable better unit testing of form field components
4. Apply Vercel React best practices (component memoization, proper state management)

## Non-Goals

- Changing form behavior or user-visible features
- Altering validation logic or error handling
- Modifying the expense data model or schemas
- Performance optimization beyond component organization

## Proposed Approach

Extract the following composable components from `expense-form.tsx`:

1. **`ExpenseFormField`** - Base wrapper for form fields with consistent label/description/message structure
2. **`TitleInput`** - Expense title field with category extraction on blur
3. **`DateInput`** - Date picker for expense date
4. **`AmountInput`** - Amount field with currency symbol and income/reimbursement toggles
5. **`CurrencySelectorField`** - Currency selection with conversion support
6. **`PaidBySelector`** - Participant payer dropdown
7. **`CategoryFormField`** - Category selection wrapper
8. **`NotesInput`** - Textarea for notes
9. **`RecurrenceRuleSelector`** - Recurrence rule dropdown
10. **`ParticipantSelector`** - Multi-select for who the expense is paid for
11. **`SplitModeSelector`** - Split mode selection dropdown
12. **`PaidForField`** - Complex participant shares editor

Each component will:

- Accept `useFormContext` or explicit control props
- Support translation via next-intl
- Follow existing shadcn/UI component patterns
- Export from `src/components/expense-form-fields/` directory

## Impact

- **Codebase**: Reduce expense-form.tsx from ~1300 to ~300 lines
- **Maintainability**: Individual form fields can be modified in isolation
- **Testability**: Components can be unit tested independently
- **Performance**: Enables targeted memoization of expensive field components (per `rerender-memo` best practice)

## Alternatives Considered

1. **Do nothing** - Current form works but is difficult to maintain
2. **Full rewrite with form library** - Overkill for current needs, would introduce breaking changes
3. **Extract only most complex fields** - Partial improvement; better to refactor consistently

## Dependencies

None - pure refactoring of existing code

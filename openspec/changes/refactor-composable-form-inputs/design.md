# Design: Composable Form Input Components

## Component Architecture

### Directory Structure

```
src/components/expense-form-fields/
├── index.ts                    # Barrel exports
├── expense-form-field.tsx      # Base wrapper component
├── title-input.tsx             # Title field with category extraction
├── date-input.tsx              # Date picker
├── amount-input.tsx            # Amount with currency & reimburse toggle
├── currency-selector-field.tsx # Currency selection
├── paid-by-selector.tsx        # Payer participant dropdown
├── category-form-field.tsx     # Category selection wrapper
├── notes-input.tsx             # Notes textarea
├── recurrence-rule-selector.tsx # Recurrence rule dropdown
├── participant-selector.tsx     # Multi-select for "paid for"
├── split-mode-selector.tsx      # Split mode dropdown
└── paid-for-field.tsx           # Complex participant shares editor
```

## Component Design Principles

### 1. Form Integration Pattern

Components use `useFormContext<ExpenseFormValues>()` to access form state, with optional `control` prop for flexibility:

```typescript
type BaseFieldProps = {
  name: Path<ExpenseFormValues>
  control?: Control<ExpenseFormValues>
}

export function TitleInput({ name = 'title', control }: BaseFieldProps) {
  const { control: contextControl } = useFormContext<ExpenseFormValues>()
  const formControl = control ?? contextControl
  // ...
}
```

### 2. Translation Support

All components accept optional translation key prefix:

```typescript
type Props = BaseFieldProps & {
  label?: string // Override default label
  description?: string // Override default description
}

const t = useTranslations('ExpenseForm')
const defaultLabel = t('Expense.TitleField.label')
```

### 3. Vercel Best Practices

#### `rerender-memo` - Component Memoization

Complex components wrap expensive calculations in `useMemo`:

```typescript
export function PaidForField({ name = 'paidFor', control }: BaseFieldProps) {
  // Memoize participant list if group doesn't change
  const participantRows = useMemo(
    () => participants.map(p => <ParticipantRow key={p.id} participant={p} />),
    [participants, splitMode, groupCurrency],
  )
  // ...
}
```

#### `rerender-defer-reads` - Avoid State Subscription

Use `form.getValues()` instead of `form.watch()` for values only used in callbacks:

```typescript
const handleAmountChange = (value: string) => {
  // Don't subscribe to 'amount' - read only when needed
  const currentAmount = form.getValues('amount')
  // ...
}
```

### 4. Component Props Pattern

#### Simple Fields (Input, Select)

```typescript
type InputFieldProps = BaseFieldProps & {
  label?: string
  placeholder?: string
  disabled?: boolean
  className?: string
}

export function DateInput({ name = 'expenseDate', ...props }: InputFieldProps)
```

#### Complex Fields with Actions

```typescript
type AmountInputProps = BaseFieldProps & {
  currencyCode: string
  currencySymbol: string
  onIncomeChange?: (isIncome: boolean) => void
  showReimbursement?: boolean
}

export function AmountInput({ name = 'amount', currencyCode, currencySymbol, ... }: AmountInputProps)
```

#### Stateful Fields

```typescript
type PaidForFieldProps = BaseFieldProps & {
  participants: Participant[]
  groupCurrency: Currency
  splitMode: SplitMode
  conversionRequired: boolean
  originalCurrency: Currency
  onManuallyEdited?: (participantId: string) => void
}

export function PaidForField({ name = 'paidFor', participants, ... }: PaidForFieldProps)
```

## Implementation Sequence

### Phase 1: Base Infrastructure

1. Create `expense-form-field.tsx` - standardized wrapper for FormField components
2. Create `index.ts` - barrel exports

### Phase 2: Simple Input Fields (Low Risk)

3. Extract `TitleInput` - minimal dependencies
4. Extract `DateInput` - self-contained
5. Extract `NotesInput` - simple textarea
6. Extract `PaidBySelector` - standard Select dropdown
7. Extract `RecurrenceRuleSelector` - standard Select dropdown

### Phase 3: Selectors with State (Medium Risk)

8. Extract `CategoryFormField` - wraps existing CategorySelector
9. Extract `CurrencySelectorField` - wraps existing CurrencySelector
10. Extract `SplitModeSelector` - simple Select

### Phase 4: Complex Fields (High Risk)

11. Extract `AmountInput` - has income/reimbursement toggle logic
12. Extract `PaidForField` - most complex, with participant shares editing
13. Extract `ParticipantSelector` - multi-select logic

### Phase 5: Integration

14. Update `expense-form.tsx` to use new components
15. Remove unused code from expense-form.tsx
16. Run full test suite
17. Manual testing of expense create/edit flows

## Backwards Compatibility

All components maintain the exact same user-visible behavior:

- Same validation messages
- Same form field ordering
- Same error states
- Same focus management
- Same keyboard navigation

## Testing Strategy

### Unit Tests (New)

```typescript
describe('TitleInput', () => {
  it('renders label and input', () => {})
  it('calls onBlur handler', () => {})
  it('displays validation error', () => {})
})
```

### Integration Tests (Existing)

Existing E2E tests cover:

- Expense creation with all fields
- Expense editing
- Currency conversion
- Split mode changes

No E2E test changes needed since user behavior is unchanged.

## Performance Considerations

1. **Bundle Size**: Extracting components may slightly increase bundle due to additional files, but enables:

   - Tree-shaking of unused components in future
   - Code splitting with dynamic imports if needed

2. **Runtime Performance**:

   - Memoization of expensive calculations (e.g., share amounts in `PaidForField`)
   - Reduced re-renders when individual field state changes (per `rerender-memo`)
   - No additional network requests or data fetching

3. **Code Splitting**: Future option to lazy-load `PaidForField` if it becomes too large:
   ```typescript
   const PaidForField = dynamic(
     () => import('./expense-form-fields/paid-for-field'),
   )
   ```

## Migration Strategy

Incremental migration with no breaking changes:

1. Create new components alongside existing code
2. Replace fields one at a time in expense-form.tsx
3. Verify functionality after each replacement
4. Delete replaced code after verification
5. Full E2E test run after all replacements

This approach ensures we can rollback quickly if any component has issues.

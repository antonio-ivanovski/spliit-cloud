# Spec: Expense Form Composability

## MODIFIED Requirements

### Requirement: Maintain User-Visible Behavior During Refactoring

The refactored expense form SHALL maintain 100% backward compatibility with the existing implementation. All user interactions, validation, error messages, and form behavior MUST remain identical.

#### Scenario: User creates expense with all fields filled

Given the refactored expense form with composable input components
When the user fills in all form fields (title, date, amount, category, payer, participants, notes)
Then the expense is created successfully
And all form values are submitted correctly
And validation errors (if any) appear in the same locations as before

#### Scenario: User edits existing expense

Given an existing expense displayed in the edit form
When the user modifies any field
Then the field updates correctly
And changes are persisted when submitted
And the form pre-populates with correct existing values

#### Scenario: Currency conversion workflow

Given the expense form with currency conversion enabled
When the user selects a different currency
And enters an original amount
Then the converted amount is calculated correctly
And the conversion rate display works as before

#### Scenario: Split mode changes update participant shares

Given the expense form with participants selected
When the user changes the split mode from EVENLY to BY_AMOUNT
Then participant share inputs appear
And shares are distributed according to the selected mode
And manually edited shares are preserved when appropriate

#### Scenario: Form validation displays errors correctly

Given the expense form with invalid input (e.g., empty title, zero amount)
When the user attempts to submit
Then validation errors appear in the same locations
And error messages match the existing implementation
And the form prevents submission until valid

#### Scenario: Reimbursement and income detection works

Given the expense form
When the user enters a negative amount
Then the expense is detected as income
And the reimbursement checkbox is disabled
And when a positive amount is entered, reimbursement checkbox is enabled

#### Scenario: Keyboard navigation and focus management

Given the expense form
When the user uses keyboard to navigate between fields
Then focus moves in the expected tab order
And keyboard shortcuts work as before (e.g., Enter to submit where applicable)

#### Scenario: Category extraction on title blur

Given the expense form with category extraction feature enabled
When the user types an expense title and blurs the field
Then the category is extracted automatically if enabled
And the category selector updates with the extracted category

### Requirement: The refactored form MUST submit the same data format and structure as the original implementation

The refactored form SHALL submit the same data format and structure as the original implementation.

#### Scenario: Form submits correct data structure

Given the refactored expense form
When the user submits a valid expense
Then the submitted data matches the ExpenseFormValues schema
And amount values are correctly converted to minor units (cents)
And participant shares are calculated correctly based on split mode
And all optional fields are handled properly (missing values vs empty strings vs undefined)

#### Scenario: Local storage for default splitting options

Given the expense form with multiple participants
When the user submits with "save default splitting options" checked
Then the splitting options are saved to localStorage
And they are pre-populated on subsequent expense creations

### Requirement: Extracted form input components MUST be reusable across different contexts

Extracted form input components SHALL be reusable across different contexts.

#### Scenario: Component can be used with different form instances

Given an extracted form field component (e.g., TitleInput)
When the component is used with a different useForm instance
Then the component works correctly with the new form context
And all validation and behavior functions as expected

#### Scenario: Component accepts custom label and description overrides

Given an extracted form field component
When the component receives custom label and description props
Then the custom values are displayed
And default translations are overridden

#### Scenario: Component supports both useFormContext and explicit control prop

Given an extracted form field component
When used without a useFormContext provider
Then the component can accept an explicit control prop
And works correctly without the context

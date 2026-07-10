## MODIFIED Requirements

### Requirement: Existing-group currency editing is conditional

The group settings form SHALL show Group information as vertical details. For a group with no expenses, it SHALL initially show a read-only current-currency identity and reveal the editable `CurrencySelector` only after an inline “Change currency” action. For a group with expenses, it SHALL show currency as read-only with a “Migrate currency” action to `/groups/$groupId/edit/currency-migration`, and SHALL remove the prior helper text that claimed changing currency would not convert expenses.

#### Scenario: No-expense group can change currency in settings

- **WHEN** the group settings form is rendered for an existing group with no expenses
- **THEN** the form SHALL render the current currency as read-only
- **AND** selecting “Change currency” SHALL render the editable `CurrencySelector`

#### Scenario: Group with expenses uses migration action

- **WHEN** the group settings form is rendered for an existing group with expenses
- **THEN** the form SHALL NOT render an editable `CurrencySelector`
- **AND** it SHALL show the current currency identity and the Migrate currency action

#### Scenario: Direct update remains guarded

- **WHEN** a client submits `groups.update` with a changed currency for a ledger that has expenses
- **THEN** the mutation SHALL reject the direct change
- **AND** it SHALL not modify the ledger or expenses

## ADDED Requirements

### Requirement: Participant headers expose grouped settlement actions
The balances page SHALL expose a settlement action on every participant header in both payer and receiver direction groups, including groups with one recommendation, subject to the same archived and pending-invitee restrictions as existing reimbursement creation.

#### Scenario: Payer header action
- **WHEN** a participant has one or more suggested legs where they are `from`
- **THEN** the payer header shows a `Settle` action that opens the grouped settlement preview for those legs

#### Scenario: Receiver header action
- **WHEN** a participant has one or more suggested legs where they are `to`
- **THEN** the receiver header shows a `Settle` action that opens the grouped settlement preview for those legs

#### Scenario: Read-only group state
- **WHEN** the group is archived or the viewer is a pending invitee
- **THEN** settlement actions are hidden or unavailable and no reimbursement mutation can be submitted

### Requirement: Grouped settlement preview supports exact leg selection
The settlement preview SHALL show every leg in the selected participant-direction group as an accessible checkbox with its counterparty, direction, and exact amount, and SHALL display the selected count and total.

#### Scenario: Header opens with all legs selected
- **WHEN** the preview is opened from a participant header
- **THEN** all compatible legs in that group are initially checked and the primary action reflects their count and summed amount

#### Scenario: Row opens with one leg selected
- **WHEN** the existing payer-row `Mark as paid` action opens the preview
- **THEN** only the clicked leg is initially checked and other compatible legs are available to select

#### Scenario: Selection changes total
- **WHEN** the user checks or unchecks a leg
- **THEN** the selected count, displayed total, accessible announcement, and primary action update immediately

#### Scenario: Empty selection
- **WHEN** no legs are checked
- **THEN** the record action is disabled and the preview remains open for further selection

### Requirement: Selected legs record as one reimbursement expense
The system SHALL create exactly one reimbursement expense for the selected legs, preserving each leg's exact amount and the current currency conversion context.

#### Scenario: One payer settles multiple recipients
- **WHEN** selected legs share one `from` participant
- **THEN** the expense has one `BY_AMOUNT` payer row for the summed amount and one `BY_AMOUNT` paid-for row per selected recipient

#### Scenario: Multiple payers settle one recipient
- **WHEN** selected legs share one `to` participant
- **THEN** the expense has one `BY_AMOUNT` payer row per selected payer and one `BY_AMOUNT` paid-for row for the summed recipient amount

#### Scenario: Successful grouped recording
- **WHEN** the create mutation succeeds
- **THEN** the preview closes, a grouped-settlement success toast is shown, and balances are invalidated so the selected recommendations disappear

### Requirement: Grouped settlements remain editable
The preview SHALL provide an edit path that prepopulates the normal expense form with the selected payer/recipient rows, exact amounts, reimbursement marker, Payment category, and currency conversion.

#### Scenario: Edit outgoing group
- **WHEN** the user chooses edit for a payer group with multiple recipients
- **THEN** the expense form opens with one payer, multiple `BY_AMOUNT` recipients, and the summed amount

#### Scenario: Edit incoming group
- **WHEN** the user chooses edit for a receiver group with multiple payers
- **THEN** the expense form opens with multiple `BY_AMOUNT` payers, one recipient, and the summed amount

#### Scenario: Invalid multi-settlement URL state
- **WHEN** the serialized multi-settlement parameters are missing, malformed, or reference unknown participants
- **THEN** the form safely rejects invalid rows and falls back to the existing scalar reimbursement defaults when available

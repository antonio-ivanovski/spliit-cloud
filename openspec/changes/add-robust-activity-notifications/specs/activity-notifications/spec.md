## ADDED Requirements

### Requirement: Expense activity email notifications
The system SHALL send immediate email notifications for expense create, update, and delete activity events to eligible affected participants after the expense mutation commits.

#### Scenario: Expense created notification
- **WHEN** an active group member creates an expense with other active accepted account-backed participants
- **THEN** the system sends an expense-created email to eligible affected participants other than the actor

#### Scenario: Expense updated notification
- **WHEN** an active group member updates an expense
- **THEN** the system sends an expense-updated email to eligible participants affected by either the previous expense state or the updated expense state other than the actor

#### Scenario: Expense deleted notification
- **WHEN** an active group member deletes an expense
- **THEN** the system sends an expense-deleted email to eligible participants affected by the deleted expense state other than the actor

#### Scenario: Email includes relevant link
- **WHEN** the system sends an expense notification email
- **THEN** the email subject identifies Spliit Cloud and the email body includes the most relevant available link to the expense, group, or app

#### Scenario: Notification failure is non-blocking
- **WHEN** an expense notification email fails to send
- **THEN** the system logs the failure and the original expense mutation remains successful

### Requirement: Expense notification recipient eligibility
The system SHALL deliver expense notification emails only to affected active, accepted, account-backed group members with non-placeholder email addresses.

#### Scenario: Actor excluded
- **WHEN** the actor is an affected expense participant
- **THEN** the system does not send the actor an expense notification email

#### Scenario: Active affected member included
- **WHEN** an affected expense participant is backed by an active group member account with a non-placeholder email address and is not the actor
- **THEN** the system sends that account an expense notification email

#### Scenario: Pending invitee excluded
- **WHEN** an affected expense participant is backed only by a pending invitation
- **THEN** the system does not send an expense notification email to that invitee

#### Scenario: Removed or left member excluded
- **WHEN** an affected expense participant is backed by a group member whose status is LEFT or REMOVED
- **THEN** the system does not send that account an expense notification email

#### Scenario: Unlinked participant excluded
- **WHEN** an affected expense participant is an unlinked ledger participant without an account-backed group member
- **THEN** the system does not send an expense notification email for that participant

#### Scenario: Placeholder email excluded
- **WHEN** an otherwise eligible affected participant has a placeholder email address
- **THEN** the system does not send an expense notification email to that address

### Requirement: Activity notification dispatch abstraction
The system SHALL route activity notifications through a dispatcher abstraction that can support multiple implementations and future durable delivery tracking.

#### Scenario: Dispatch after commit
- **WHEN** a mutation creates an activity that can trigger notifications
- **THEN** the system dispatches notifications only after the mutation transaction commits

#### Scenario: Dispatch has activity identity
- **WHEN** the notification dispatcher receives an event
- **THEN** the event includes the created activity identifier, activity type, group identifier, actor identity, subject identity, and event-specific metadata

#### Scenario: No direct email coupling in mutation logic
- **WHEN** an expense mutation completes
- **THEN** mutation logic invokes the activity notification dispatcher rather than calling email delivery helpers directly

#### Scenario: Future delivery compatibility
- **WHEN** durable notification delivery is added later
- **THEN** the dispatcher contract provides enough context to create per-recipient delivery records and retry failed deliveries without changing expense mutation call sites

### Requirement: Non-expense activity notification suppression
The system SHALL NOT send email notifications for group, invitation, member, archive, or role-change activity events in the initial implementation.

#### Scenario: Invitation activity creates no email
- **WHEN** an invitation is created, revoked, accepted, or declined
- **THEN** the system records activity but does not send an email notification for that activity

#### Scenario: Member activity creates no email
- **WHEN** a member leaves, is removed, or has their role changed
- **THEN** the system records activity but does not send an email notification for that activity

#### Scenario: Group activity creates no email
- **WHEN** group settings or archive state changes
- **THEN** the system records activity but does not send an email notification for that activity

## ADDED Requirements

### Requirement: Expense activity email notifications
The system SHALL send immediate email notifications for expense create, update, delete, and bulk-import-summary activity events to eligible affected participants after the expense mutation commits.

#### Scenario: Expense created notification
- **WHEN** an active group member creates an expense with other active accepted account-backed participants
- **THEN** the system sends an expense-created email to eligible affected participants other than the actor
- **AND** the email subject SHALL use the passive format: `[Spliit Cloud] Expense "title" was added by actorName to groupName`
- **AND** the email body SHALL use the passive format: `Expense "title" (amount) was added by actorName to groupName on date.`

#### Scenario: Expense updated notification
- **WHEN** an active group member updates an expense
- **THEN** the system sends an expense-updated email to eligible participants affected by either the previous expense state or the updated expense state other than the actor
- **AND** the email subject SHALL use the passive format: `[Spliit Cloud] Expense "title" was updated by actorName in groupName`
- **AND** the email body SHALL include the changed fields section

#### Scenario: Expense deleted notification
- **WHEN** an active group member deletes an expense
- **THEN** the system sends an expense-deleted email to eligible participants affected by the deleted expense state other than the actor
- **AND** the email subject SHALL use the passive format: `[Spliit Cloud] Expense "title" was removed by actorName from groupName`
- **AND** the email body SHALL use the passive format: `Expense "title" (amount) was removed by actorName from groupName on date.`

#### Scenario: Bulk import summary notification
- **WHEN** expenses are imported in bulk from an external source
- **THEN** the system sends a single summary email per eligible affected active member with the import count, total amount, and source provider
- **AND** the email subject SHALL use the format: `[Spliit Cloud] N expenses imported in groupName`

#### Scenario: Settlement expense notification
- **WHEN** a member leaves, is removed, or a group is archived and settlement expenses are created
- **THEN** the system sends expense-created emails to eligible affected participants for each settlement expense
- **AND** these notifications follow the same expense-created format

#### Scenario: Recurring expense notification
- **WHEN** a recurring expense is auto-created by the system
- **THEN** the system sends an expense-created email with SYSTEM actor to eligible affected participants
- **AND** these notifications follow the same expense-created format

#### Scenario: Email includes relevant link
- **WHEN** the system sends an expense notification email
- **THEN** the email subject identifies Spliit Cloud and the email body includes the most relevant available link to the expense, group, or app

#### Scenario: Notification failure is non-blocking
- **WHEN** an expense notification email fails to send
- **THEN** the system logs the failure and the original expense mutation remains successful

### Requirement: Per-recipient friend-ledger display name in email notifications
The system SHALL resolve friend-ledger display names per recipient when sending expense notification emails. The display name SHALL reflect the OTHER member's perspective relative to each individual recipient, not the actor's perspective. This ensures each recipient sees "your friend ledger with {peerName}" where the peer is the member opposite the recipient.

#### Scenario: Recipient sees peer name, not self
- **WHEN** the system sends an expense notification email for a `FRIEND`-typed group
- **THEN** the group display name SHALL be computed using the recipient's account ID to find the peer (the other active member)
- **AND** the email SHALL show `your friend ledger with {peerName}` where peerName is the OTHER member's name
- **AND** the email SHALL NOT show the recipient's own name in the ledger reference

#### Scenario: No active peer — use pending invitation name
- **WHEN** the system sends an expense notification email for a `FRIEND`-typed group and the peer has only a pending invitation (no active membership)
- **THEN** the group display name SHALL fall back to `your friend ledger with {temporaryName}` if a pending invitation exists

#### Scenario: No peer information — generic fallback
- **WHEN** the system sends an expense notification email for a `FRIEND`-typed group and neither an active peer nor a pending invitation can be resolved
- **THEN** the group display name SHALL use the generic `your friend ledger`

### Requirement: Currency formatting in expense notification emails
The system SHALL format monetary amounts in expense notification emails with the ISO currency code prefix and the correct number of decimal places per the currency's definition. For expenses with a foreign currency, the email SHALL display both the original amount and the ledger-converted amount.

#### Scenario: Amount formatted with currency code
- **WHEN** the system sends an expense notification email with a known currency code
- **THEN** the amount SHALL be formatted as `{currencyCode} {amount}` (e.g. `EUR 45.00`, `JPY 1000`)
- **AND** decimal digits SHALL be determined by the currency's `decimal_digits` metadata (0 for JPY, 2 for EUR/USD)

#### Scenario: Dual-currency display for cross-currency expenses
- **WHEN** the system sends an expense notification email and the expense has a `originalCurrency` that differs from the ledger's currency
- **THEN** the amount SHALL be displayed as `{originalAmount} ({convertedAmount})` (e.g. `JPY 5000 (EUR 6.70)`)

#### Scenario: Same-currency expense uses ledger currency
- **WHEN** the system sends an expense notification email and the expense has no `originalCurrency` (same-currency expense)
- **THEN** the amount SHALL be formatted using the ledger's currency code
- **AND** the email SHALL NOT show a bare numeric amount without a currency prefix

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

#### Scenario: Dispatcher supports multiple implementations
- **WHEN** the notification dispatcher receives an event
- **THEN** it routes to every registered dispatcher implementation in parallel, continuing when individual implementations fail

#### Scenario: Dispatch composability
- **WHEN** new notification channels are added
- **THEN** the composite dispatcher forwards events to all registered implementations without requiring changes to mutation call sites

#### Scenario: Dispatch for non-expense mutations
- **WHEN** expense mutations are not involved (e.g. member leave that creates settlement expenses)
- **THEN** the created settlement expenses still dispatch EXPENSE_CREATED notifications through the same dispatcher

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

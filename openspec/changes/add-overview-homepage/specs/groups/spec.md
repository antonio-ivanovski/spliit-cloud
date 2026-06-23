## ADDED Requirements

### Requirement: Membership-backed group summaries
The overview SHALL show group summaries from server-side membership data, not browser-local recent group data.

#### Scenario: Group summary list
- **WHEN** an authenticated user opens the overview
- **THEN** the system lists groups accessible through membership

### Requirement: Account-scoped group archive
The system SHALL support account-scoped group archive preferences that affect only the current account's group list presentation and do not remove membership.

#### Scenario: User archives group
- **WHEN** a user archives a group with zero balance
- **THEN** the group is archived only for that account

#### Scenario: Archive blocked with unsettled balance
- **WHEN** a user attempts to archive a group with non-zero balance
- **THEN** the system blocks archival unless the user selects the force settlement option

#### Scenario: Force archive settlement
- **WHEN** a user force-archives a group with non-zero balance
- **THEN** the system creates a normal reimbursement expense with an archival title/note that brings that account's group balance to zero before archiving

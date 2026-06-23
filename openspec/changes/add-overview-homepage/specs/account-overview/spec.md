## ADDED Requirements

### Requirement: Authenticated account overview
The system SHALL render an authenticated homepage overview that summarizes the current account's groups, direct relationships, balances, recent expenses, recent activity, and quick actions.

#### Scenario: Signed-in homepage
- **WHEN** an authenticated user opens the homepage
- **THEN** the system shows an account overview instead of the signed-out landing content

#### Scenario: Signed-out homepage
- **WHEN** an unauthenticated user opens the homepage
- **THEN** the system shows signed-out landing or sign-in entry content

### Requirement: Bounded overview data
The system SHALL bound recent expenses and recent activity returned for the overview and SHALL use server-side aggregate balance queries or Ledger helpers for totals.

#### Scenario: Recent expenses
- **WHEN** the overview loads
- **THEN** recent expenses are limited to the configured overview count

#### Scenario: Aggregate totals
- **WHEN** the overview displays totals
- **THEN** totals are computed server-side from accessible Ledgers

### Requirement: Linked import balances
The system SHALL include balances from imported participant entries in account-level overview totals after those entries are linked to the account.

#### Scenario: Imported participant linked
- **WHEN** an imported unlinked participant entry is linked to the current account
- **THEN** the overview includes that participant entry's historical balances in the current account totals

### Requirement: Overview quick actions
The system SHALL provide overview entry points for creating a group, creating a direct expense when enabled, importing a Spliit group, and joining pending invitations.

#### Scenario: Import quick action
- **WHEN** an authenticated user opens the overview
- **THEN** the user can navigate to the Spliit import flow

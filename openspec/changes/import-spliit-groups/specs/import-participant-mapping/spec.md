## ADDED Requirements

### Requirement: Participant mapping modes in the wizard

The system SHALL let the importer map each source participant to the importer's own account (`LINK_ACCOUNT`), to an invite by email (`INVITE_BY_EMAIL`) or by link (`INVITE_BY_LINK`), to an existing destination `LedgerParticipant` (`LINK_EXISTING_PARTICIPANT`), or to a new unlinked participant entry (`UNLINKED_PARTICIPANT`).

#### Scenario: Link to the importer's own account

- **WHEN** the importer maps a source participant to their own account
- **THEN** the destination `LedgerParticipant` is `ACCOUNT_MEMBER` and a `GroupMember` is created or reactivated if needed

#### Scenario: Invite by email

- **WHEN** the importer maps a source participant to invite by email
- **THEN** the server creates an EMAIL-type `GroupInvitation` after the import commits and sends an invitation email

#### Scenario: Invite by link

- **WHEN** the importer maps a source participant to invite by link
- **THEN** the server creates a LINK-type `GroupInvitation` after the import commits and returns the invite URL

#### Scenario: Leave participant unlinked

- **WHEN** the importer maps a source participant as unlinked
- **THEN** the destination `LedgerParticipant` is `UNLINKED_PARTICIPANT` with the source name as its `displayName` and no app access

### Requirement: One-way admin participant linking

The system SHALL let an owner or admin link an unlinked `LedgerParticipant` to an existing account as a one-way ownership migration. After the link, the historical and future balances of the `LedgerParticipant` are associated with the account and appear in account-level views.

#### Scenario: Admin maps an unlinked participant

- **WHEN** an owner or admin maps an unlinked `LedgerParticipant` to an account
- **THEN** the system migrates the `LedgerParticipant` to `ACCOUNT_MEMBER` and creates or activates the account's `GroupMember` if needed

#### Scenario: Linked balances surface in the account

- **WHEN** an unlinked `LedgerParticipant` is linked to an account
- **THEN** historical and future balances for that `LedgerParticipant` immediately contribute to the linked account's group and overview totals

#### Scenario: Destination account is already a member

- **WHEN** an owner or admin links an unlinked `LedgerParticipant` to an account that is already an active `GroupMember` of the same group with its own `LedgerParticipant` in the same ledger
- **THEN** the system merges the unlinked LP into the existing member's `LedgerParticipant`: it rewrites all `Expense.paidById` and `ExpensePaidFor.ledgerParticipantId` references from the unlinked LP to the existing LP and deletes the unlinked LP
- **THEN** the existing member's `LedgerParticipant` and `GroupMember` rows are unchanged
- **THEN** the historical and future balances for the unlinked LP are attributed to the existing member

### Requirement: Linking an unlinked participant to a pending invitation

The system SHALL let an owner or admin link an unlinked `LedgerParticipant` to a pending EMAIL-type or LINK-type `GroupInvitation` in the same group. The unlinked LP SHALL be merged into the pending invitation's materialized `LedgerParticipant`: its `paidBy` and `paidFor` references are rewritten to the invitation's LP, and the unlinked LP is deleted. The pending invitation's LP is preserved; when the invitee accepts, that LP becomes the account-backed entry. Matching is by `pendingInvitationId`, so both EMAIL- and LINK-type invitations are supported.

#### Scenario: Admin links an unlinked participant to a pending invitation

- **WHEN** an owner or admin links an unlinked `LedgerParticipant` to a pending `GroupInvitation` (EMAIL or LINK type) in the same group
- **THEN** the system rewrites all `Expense.paidById` and `ExpensePaidFor.ledgerParticipantId` references from the unlinked LP to the invitation's `LedgerParticipant.id`
- **THEN** the unlinked `LedgerParticipant` is deleted
- **THEN** the invitation's `LedgerParticipant` is preserved and becomes the canonical entry for the invitee

#### Scenario: Candidates list includes pending invitations

- **WHEN** the link modal queries candidates for an unlinked `LedgerParticipant`
- **THEN** the result list includes both active `GroupMember` candidates and pending `GroupInvitation` candidates (EMAIL and LINK types, each with a materialized `LedgerParticipant` in the same ledger)
- **THEN** each candidate carries a `kind` of `MEMBER` or `PENDING` and a `name` resolved from `Account.name` (for members) or `temporaryName` falling back to the invitation email (for pending invitations)
- **THEN** the server materializes any pending invitation that lacks a `LedgerParticipant` before returning the candidate list (creates one lazily)

#### Scenario: Expense leg conflict blocks a pending candidate

- **WHEN** the link modal computes the blocked set from expenses involving the unlinked LP
- **THEN** the blocked set applies uniformly to MEMBER and PENDING candidates — a pending invitation whose materialized LP is on the opposite side of an expense leg is excluded

### Requirement: Unlinked participants have no app access

The system SHALL distinguish authenticated group members from unlinked `LedgerParticipant` entries and SHALL NOT grant group access to unlinked participants.

#### Scenario: Unlinked participant exists

- **WHEN** an imported group contains an unlinked `LedgerParticipant` entry
- **THEN** that entry can appear in expenses and balances but cannot sign in or access the group

#### Scenario: Unlinked entry surfaces in the UI

- **WHEN** an unlinked `LedgerParticipant` appears in an expense card, a balance row, the expense form, or the admin link list
- **THEN** the UI labels it as unlinked so it is not confused with an app user

### Requirement: Mapping to an existing destination LedgerParticipant (LINK_EXISTING_PARTICIPANT)

For existing-group imports, the wizard SHALL offer a "Link to existing member" option that maps a source participant directly onto an existing `LedgerParticipant` in the destination group (active member or pending invitation). This avoids creating duplicate participant entries for people already in the group.

#### Scenario: Link to an existing member

- **WHEN** the importer selects "Link to existing member" for a source participant in an existing-group import
- **THEN** the mapping step shows a picker with the group's active members under a "Members" heading and pending invitations under a "Pending invites" heading
- **THEN** after selection the mapping produces a `LINK_EXISTING_PARTICIPANT` entry with the chosen `LedgerParticipant.id`
- **THEN** the source participant's expenses reference the chosen LP directly; no new participant row is created

### Requirement: Auto-matching source participants to existing members by name

When the user chooses to import into an existing group, the system SHALL apply automatic matching via `applyAutoMatch`. Source participant names that overlap with destination member names (case-insensitive substring overlap) are auto-configured to `LINK_EXISTING_PARTICIPANT`.

#### Scenario: Exact name match

- **WHEN** a source participant name case-insensitively matches a destination member name
- **THEN** that source row is auto-mapped to `LINK_EXISTING_PARTICIPANT` with the matched destination `LedgerParticipant.id`

#### Scenario: Substring overlap match

- **WHEN** no exact match exists but the source name is a substring of a destination name, or vice versa
- **THEN** the longest overlapping pair is auto-mapped to `LINK_EXISTING_PARTICIPANT`

#### Scenario: No match leaves the row unchanged

- **WHEN** no destination name overlaps with the source participant name
- **THEN** the source row keeps its existing mapping mode

#### Scenario: First participant (importer) is excluded from auto-match

- **WHEN** the auto-match runs
- **THEN** the first participant (`index === 0`, the importer's own row) is never auto-matched regardless of name overlap

### Requirement: Conflict detection rules A–D in the mapping step

The system SHALL detect four types of mapping conflicts (`findImportConflicts`) and block the user from confirming the mapping step until all conflicts are resolved.

#### Scenario: Rule A — duplicate destination LedgerParticipant

- **WHEN** two source rows both have `LINK_EXISTING_PARTICIPANT` mode pointing at the same `LedgerParticipant.id`
- **THEN** both rows show the conflict message "Two source rows are mapped to the same existing member."

#### Scenario: Rule B — invite-by-email conflicts with a pending invitation

- **WHEN** a row has `INVITE_BY_EMAIL` mode and the invite email's name overlaps (case-insensitive substring) with a pending invitation's display name that is already linked from another source row
- **THEN** the invite row shows: "You're inviting X but they're already a pending invite; link to them instead."

#### Scenario: Rule C — invite-by-email conflicts with an active member

- **WHEN** a row has `INVITE_BY_EMAIL` mode and the invite email's name overlaps (case-insensitive substring) with an active member's display name that is already linked from another source row
- **THEN** the invite row shows: "You're inviting X but they're already a member of this group; link to them instead."

#### Scenario: Rule D — two existing members look like the same person

- **WHEN** two rows have `LINK_EXISTING_PARTICIPANT` mode pointing at different `LedgerParticipant` ids whose display names overlap (case-insensitive substring, both longer than 2 characters)
- **THEN** both rows show: "Two existing members look like the same person — pick one."

### Requirement: Members page link modal

The group Members page SHALL provide a modal dialog for admins to link unlinked participants to accounts or pending invitations.

#### Scenario: Admin opens the link modal

- **WHEN** an admin clicks the "Link" action for an unlinked `LedgerParticipant` on the Members page
- **THEN** the modal queries the server for compatible candidates (active members and pending invitations with a materialized `LedgerParticipant`)
- **THEN** the server excludes the unlinked LP itself and any LP on the opposite side of an expense leg involving the unlinked LP
- **THEN** candidates are sorted by name and grouped by kind (MEMBER / PENDING)

#### Scenario: Admin links to an active member via the modal

- **WHEN** the admin selects an active member candidate in the modal
- **THEN** the client calls `linkUnlinkedParticipantToAccount`
- **THEN** if the account already has its own `LedgerParticipant`, the unlinked LP's references are merged via `mergeLedgerParticipantReferences` and the unlinked LP is deleted
- **THEN** if the account is not yet a member, a new `GroupMember` is created and the unlinked LP is reassigned to it

#### Scenario: Admin links to a pending invitation via the modal

- **WHEN** the admin selects a pending invitation candidate in the modal
- **THEN** the client calls `linkUnlinkedParticipantToPendingInvite` with the `pendingInvitationId`
- **THEN** the unlinked LP's expense references are rewritten onto the invitation's materialized LP and the unlinked LP is deleted

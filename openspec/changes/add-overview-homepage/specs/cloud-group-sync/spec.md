## ADDED Requirements

### Requirement: Server-backed overview state

The overview SHALL use server-backed account, membership, preference, and Ledger data.

#### Scenario: Browser local group list exists

- **WHEN** browser-local group data exists
- **THEN** the overview does not use it as the authoritative group list

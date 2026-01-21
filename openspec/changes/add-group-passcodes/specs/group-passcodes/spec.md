## ADDED Requirements

### Requirement: Optional Group Passcode

The system SHALL allow a group to be configured with an optional passcode.

#### Scenario: Group without passcode

- **GIVEN** a group has no passcode configured
- **WHEN** a user accesses the group via its URL
- **THEN** the system allows access without requesting a passcode

#### Scenario: Enable a passcode

- **WHEN** a user enables a passcode for a group
- **THEN** the system stores only a non-reversible hash of the passcode
- **AND** the system does not store the plaintext passcode

#### Scenario: Disable a passcode

- **WHEN** a user disables a passcode for a group
- **THEN** the system removes the stored passcode hash
- **AND** the group becomes accessible without a passcode

### Requirement: Group Protection Modes

The system SHALL support configuring what operations require a passcode for a group.

#### Scenario: Protect read access

- **GIVEN** a group is configured to require a passcode for read access
- **WHEN** a user attempts to read group details without providing the passcode
- **THEN** the system denies access

#### Scenario: Protect write access

- **GIVEN** a group is configured to require a passcode for write access
- **WHEN** a user attempts to create, update, or delete group data without providing the passcode
- **THEN** the system denies access
- **AND** read operations MAY be permitted if read protection is not enabled

#### Scenario: Protect read and write access

- **GIVEN** a group is configured to require a passcode for both read and write access
- **WHEN** a user attempts to read or mutate group data without providing the passcode
- **THEN** the system denies access

### Requirement: Passcode Verification

The system SHALL verify the passcode for protected group operations.

#### Scenario: Successful passcode verification

- **GIVEN** a group is protected
- **WHEN** a user provides the correct passcode
- **THEN** the system allows the requested protected operation

#### Scenario: Failed passcode verification

- **GIVEN** a group is protected
- **WHEN** a user provides an incorrect passcode
- **THEN** the system denies the request
- **AND** the system does not reveal whether the group exists beyond a generic error

#### Scenario: Passcode is never returned

- **WHEN** the system returns group data
- **THEN** it SHALL NOT include the plaintext passcode
- **AND** it SHALL NOT include the passcode hash

### Requirement: Client Unlock Flow

The system SHALL provide a client flow to unlock protected groups.

#### Scenario: Prompt for passcode

- **GIVEN** a user navigates to a protected group
- **WHEN** the user has not yet unlocked the group on the current device/session
- **THEN** the system prompts for the group passcode

#### Scenario: Remember unlocked state

- **WHEN** a user successfully unlocks a group
- **THEN** the system remembers the unlocked state on that device
- **AND** subsequent protected operations do not require re-entering the passcode during that remembered window

### Requirement: Sync Unlocked State (Optional)

The system SHALL sync a user's unlocked-group state across devices when Group Sync is enabled.

#### Scenario: Unlocked state is included in sync payload

- **GIVEN** Group Sync is enabled for the user
- **AND** the user has unlocked a protected group on device A
- **WHEN** Group Sync pushes joined group data
- **THEN** the sync payload includes the user's unlock material for that group
- **AND** that material is stored in a secure form (encrypted or equivalent)

#### Scenario: New device restores unlocked state

- **GIVEN** Group Sync is enabled for the user
- **AND** the user signs in on device B
- **WHEN** Group Sync pulls joined group data
- **THEN** the user's unlock material for the protected group is restored
- **AND** the user can access the protected group without re-entering the passcode

## ADDED Requirements

### Requirement: Authorized document uploads
The system SHALL create upload presign URLs only for authenticated accounts authorized to attach documents to the target Ledger.

#### Scenario: Authorized member requests upload
- **WHEN** an authenticated member requests an upload URL for a Ledger they can edit
- **THEN** the system returns a presigned upload URL

#### Scenario: Unauthorized request
- **WHEN** a request has no authenticated account or no Ledger access
- **THEN** the system rejects the upload request

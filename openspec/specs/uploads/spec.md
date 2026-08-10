## Purpose

Defines authorization, scoping, and lifecycle requirements for user-uploaded and import-staged document objects.

## Requirements

### Requirement: Authorized document uploads
The system SHALL create upload presign URLs only for authenticated accounts authorized to attach documents to the target Ledger.

#### Scenario: Authorized member requests upload
- **WHEN** an authenticated member requests an upload URL for a Ledger they can edit
- **THEN** the system returns a presigned upload URL

#### Scenario: Unauthorized request
- **WHEN** a request has no authenticated account or no Ledger access
- **THEN** the system rejects the upload request

### Requirement: Import staging claims are scoped and temporary
Import document source and staged upload claims SHALL be bound to the authenticated account and import session and SHALL not grant access to another account or session. Staged objects SHALL use the `tmp/imports/<account>/<session>/` namespace and SHALL be subject to a 24-hour object-storage lifecycle rule. Successful import commits SHALL remove staged objects promptly; interrupted imports SHALL rely on lifecycle expiry for cleanup.

#### Scenario: Cross-account staged token is rejected
- **WHEN** an account submits a staged import token issued for another account or import session
- **THEN** the server rejects the token before reading or promoting the object

#### Scenario: Abandoned staged object expires
- **WHEN** a staged import is abandoned or interrupted
- **THEN** the object-storage lifecycle removes its temporary object within 24 hours

## Context

Spliit is intentionally “no auth” for core usage. Groups are accessed via a shareable URL (`/groups/:groupId`). Adding a per-group passcode should:

- Improve protection against accidental URL leakage.
- Keep the app self-hostable and low-complexity.
- Avoid introducing full user accounts for group access.

This design assumes passcodes are not a replacement for real authentication; they are an additional barrier.

## Goals / Non-Goals

### Goals

- Optional, per-group passcode.
- Protection modes: require passcode for read, for write, or for both.
- Server-side enforcement for all protected operations.
- Minimal UX friction: once unlocked, user should not have to re-enter frequently.

### Non-Goals

- Full user identity, roles, invitations, ownership, or ACL management.
- Secure end-to-end encryption.
- Per-participant permissions (read-only participants, admin participants, etc.).

## Decisions

### D1: Store only a hash (not the passcode)

**Decision**: Store `passcodeHash` in the database (e.g., Argon2id or bcrypt) and never store plaintext.

**Rationale**: Reduces risk if DB is exposed. Aligns with standard secret storage.

### D2: Protection mode on the Group

**Decision**: Add `GroupAccessMode` enum on `Group`:

- `NONE` (default)
- `READ`
- `WRITE`
- `READ_WRITE`

**Rationale**: Simple to reason about and covers request (“read or write or read/write”).

### D3: Passcode presented as a “group token” for API calls

**Decision**: After the user enters a passcode, the client stores it locally (or stores an opaque “unlock token”) and sends it with future API calls.

**Preferred MVP**: Send passcode as a header (or tRPC context header) on every request that needs it.

**Rationale**: Spliit already avoids accounts; a device-scoped unlock is consistent. A server-issued unlock token can be added later to avoid sending passcode repeatedly.

### D4: Server-side enforcement points

**Decision**: Enforce in one shared “group guard” used by:

- `groups.get`, `groups.getDetails`, `groups.list` (read paths)
- all group mutations: create/update/delete expense, update group, etc. (write paths)

**Rationale**: Avoid missing a code path.

## Data Model

Additive changes to `Group`:

- `accessMode: GroupAccessMode` (default `NONE`)
- `passcodeHash: String?` (nullable; required when accessMode != NONE)

No passcode should be stored in `Activity` log data.

## UX / UI Flow

- If a group is protected and the user has not unlocked it on this device:
  - show a dedicated “Unlock group” screen for group routes
  - allow entering passcode
  - on success: persist unlock locally and continue
- Group settings (edit group) gains:
  - enable/disable passcode
  - choose protection mode (READ / WRITE / READ_WRITE)
  - change passcode (requires current passcode)

## Risks / Trade-offs

- Passcode can be shared like the URL; still improves over URL-only in many real scenarios.
- If using “send passcode with each request” MVP, passcode exposure risk is limited by HTTPS but still not ideal.
- Recent groups list may need to handle “locked groups” (e.g., show name only after unlock or show placeholder).

## Migration Plan

- Existing groups default to `accessMode=NONE` and behave unchanged.
- When enabling passcode on a group, enforce that `passcodeHash` is set.
- If passcode is removed, clear `passcodeHash` and set `accessMode=NONE`.

## Open Questions

1. Should the passcode be required for `groups.list` group metadata (name/currency), or should list return minimal info for locked groups?
2. Should unlocking persist across browser restarts (localStorage), or only per-session (sessionStorage)?

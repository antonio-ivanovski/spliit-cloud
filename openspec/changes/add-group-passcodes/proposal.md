# Change: Add Group Passcodes for Access Control

## Why

Spliit groups are currently protected only by the unguessability of the group URL. If a group link is forwarded, leaked, or logged, anyone with the URL can read and modify group data. A lightweight, per-group passcode provides an additional layer of protection while keeping Spliit largely “no account required”.

## What Changes

- Add an optional per-group passcode.
- Add a per-group protection mode so a passcode can be required for:
  - read access (viewing group data)
  - write access (mutations like create/update/delete)
  - read+write access
- Add an “unlock” flow in the UI when a group is protected.
- Enforce protection server-side for both API reads and writes.
- When the Group Sync feature is enabled, the per-user “unlocked passcode” state for a group is synced across devices as part of the synced group data.

## Impact

- Affected specs: new capability `group-passcodes`.
- Related/Dependent specs: `openspec/changes/add-plugin-system/specs/group-sync/spec.md` (group sync will need to carry per-user group access secrets).
- Affected code (expected):
  - `prisma/schema.prisma` (Group fields for passcode + mode)
  - `src/lib/api.ts` (read/write functions need access checks)
  - `src/trpc/routers/groups/**` (procedures require passcode input or context auth)
  - `src/app/groups/[groupId]/**` (unlock UI; edit-group UI for setting passcode)
  - `src/app/groups/recent-group-list.tsx` (handle locked groups gracefully)
- Affected code (expected, when sync enabled):
  - `src/lib/plugins/sync/**` and/or `src/lib/sync-utils.ts` (include encrypted per-group passcode/unlock material in sync payload; restore on new device)
- Database: additive schema change; existing groups remain accessible (no passcode by default).
- Compatibility: group URLs remain valid; protected groups may show limited metadata until unlocked.

## 1. Database & Core Guard

- [ ] 1.1 Add `GroupAccessMode` enum + `Group.passcodeHash` + `Group.accessMode` to `prisma/schema.prisma`
- [ ] 1.2 Create DB migration
- [ ] 1.3 Add passcode hashing + verification utilities (Argon2/bcrypt)
- [ ] 1.4 Add shared “group access guard” (read/write) used by API + tRPC

## 2. tRPC API Changes

- [ ] 2.1 Update `groups.get` / `groups.getDetails` to enforce read protection
- [ ] 2.2 Update all group write procedures (group update, expense create/update/delete, etc.) to enforce write protection
- [ ] 2.3 Add a `groups.getAccess` (or similar) procedure to allow client to determine whether group is protected and what mode applies without leaking sensitive info

## 3. UI: Unlock + Settings

- [ ] 3.1 Add an “Unlock group” UI for protected groups (enter passcode)
- [ ] 3.2 Persist unlock state (localStorage or sessionStorage) and attach passcode (or unlock token) to API calls
- [ ] 3.3 Update group edit UI to set access mode and change/remove passcode
- [ ] 3.4 Ensure recent groups list and group layout handle locked groups gracefully

## 4. Validation

- [ ] 4.1 Unit tests: passcode hashing/verification; guard logic
- [ ] 4.2 E2E: protected group requires passcode (read); protected group blocks writes without passcode
- [ ] 4.3 Update docs (README or docs/agent) explaining passcode behavior and self-hosting considerations

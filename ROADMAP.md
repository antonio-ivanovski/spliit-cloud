# Roadmap

This page is the companion to the [Roadmap section in the README](./README.md#roadmap). It adds links to design docs and the status of active work.

## Phase 1: Reliable cloud foundation — shipped

- [x] Public hosted instance, PostgreSQL API, asset uploads, database backups
- [x] Account-based group ownership, multi-device sync, basic account settings

## Phase 2: Migration and compatibility — shipped

- [x] Import existing Spliit groups
- [x] Export user/group data
- [x] Migration guide ([docs/migration.md](./docs/migration.md))

## Phase 3: Better expense workflows — in progress

- [ ] Direct account-to-account expenses ([design](./openspec/changes/add-direct-account-expenses))
- [ ] Recurring expenses
- [ ] Account overview homepage ([design](./openspec/changes/add-overview-homepage))
- [x] Member management
- [ ] Notifications

## Phase 4: Trust, privacy, and scale — in progress

- [x] Test coverage for critical flows
- [ ] Better offline support
- [ ] End-to-end encrypted groups and expenses
- [ ] OpenAPI spec
- [ ] Public API / MCP support

## Cross-cutting

- Server-authoritative currency conversion ([design](./openspec/changes/server-authoritative-currency-conversion))
- Bundle-size reduction (main chunk from ~1500 kB to ~750 kB)
- TypeScript and tooling upgrades
- Weblate translation setup

## Suggesting items

Open an issue with the user problem, proposed shape, affected capabilities, and any breaking-change implications.

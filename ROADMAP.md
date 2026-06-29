# Roadmap

This page is the companion to the [Roadmap section in the README](./README.md#roadmap). It adds links to design docs and the status of active work.

Each roadmap item also references the upstream [`spliit-app/spliit`](https://github.com/spliit-app/spliit) issue or PR that motivated it, so it's clear which community demands we're tracking and where the work originated. Upstream links in **bold** mark issues with the highest community signal (top reactions, longest-standing, or already-merged-in-spirit work in someone's open PR).

## Phase 1: Reliable cloud foundation — shipped

- [x] Public hosted instance, PostgreSQL API, asset uploads, database backups
- [x] Account-based group ownership, multi-device sync, basic account settings
      — addresses upstream **[#76](https://github.com/spliit-app/spliit/issues/76)**, **[#257](https://github.com/spliit-app/spliit/issues/257)**, **[#336](https://github.com/spliit-app/spliit/issues/336)**

## Phase 2: Migration and compatibility — shipped

- [x] Import existing Spliit groups
- [x] Export user/group data
- [x] Migration guide ([docs/migration.md](./docs/migration.md))
      — addresses upstream [#22](https://github.com/spliit-app/spliit/issues/22) and the link-flow work in PR [#472](https://github.com/spliit-app/spliit/pull/472) / [#483](https://github.com/spliit-app/spliit/pull/483)

## Phase 3: Better expense workflows — in progress

### Headline features (community high-demand)

- [ ] **Multi-payer expenses** — a single expense paid by several members, with a share per payer. Closes the gap with Splitwise. — upstream **[#14](https://github.com/spliit-app/spliit/issues/14)** (PRs [#146](https://github.com/spliit-app/spliit/pull/146) / [#396](https://github.com/spliit-app/spliit/pull/396) open 1.5+ years)
- [ ] **Itemized expenses** — split an expense by line items, with tax and tip, and per-person sub-totals. The most-asked "real Splitwise" feature after recurring. — upstream [#395](https://github.com/spliit-app/spliit/issues/395)
- [ ] Direct account-to-account expenses ([design](./openspec/changes/add-direct-account-expenses))
- [ ] Recurring expenses — `calculateNextDate` and daily/weekly/monthly tests already in place
- [ ] Account overview homepage ([design](./openspec/changes/add-overview-homepage)) — also covers the cross-group balance view in upstream [#509](https://github.com/spliit-app/spliit/issues/509)
- [ ] Notifications — feature flag already in place; the implementation includes a Telegram channel (see Cross-cutting)

### Quality-of-life additions (small, high-trust, ship in batches)

- [ ] **Expense comments / notes on an expense** — upstream [#165](https://github.com/spliit-app/spliit/pull/165)
- [ ] **Copy an expense** — open the last one, click copy, save with today's date — upstream [#527](https://github.com/spliit-app/spliit/issues/527) (PRs [#394](https://github.com/spliit-app/spliit/pull/394), [#201](https://github.com/spliit-app/spliit/pull/201))
- [ ] **Math expressions in the amount field** (e.g. `12+4.50`) — upstream [#184](https://github.com/spliit-app/spliit/pull/184)
- [ ] **Default split mode persisted on group** — upstream [#366](https://github.com/spliit-app/spliit/pull/366)
- [ ] **Reorder participants** — upstream [#416](https://github.com/spliit-app/spliit/pull/416)
- [ ] **One-line quick entry** (SplittyPie style) — upstream [#384](https://github.com/spliit-app/spliit/issues/384)
- [ ] **Payment method field on an expense** — upstream [#451](https://github.com/spliit-app/spliit/pull/451)
- [ ] **Locations on expenses** — upstream [#172](https://github.com/spliit-app/spliit/pull/172)
- [ ] **QR code to share / join a group** — upstream [#500](https://github.com/spliit-app/spliit/pull/500)
- [ ] **Recurring expense stats** — cumulative per recurrence period. Lands for free once recurring ships. — upstream [#508](https://github.com/spliit-app/spliit/issues/508)
- [x] Member management

## Phase 4: Trust, privacy, and scale — in progress

### Headline features (the moat)

- [ ] **End-to-end encrypted groups and expenses** — per-group passphrase protecting group, participant, and expense data with a client-side derivation layer. The single biggest open-source expense-splitter differentiator and a real answer to upstream **[#34](https://github.com/spliit-app/spliit/issues/34)** (open since 2024, never touched).
- [ ] **OpenAPI spec + Public API + MCP support** — tRPC → OpenAPI is largely free; expose a stable public surface behind per-user API tokens. Closes upstream **[#117](https://github.com/spliit-app/spliit/issues/117)** (top-reacted, 2+ years) and unlocks automation / agent workflows.
- [ ] **Better offline support** — improve the existing PWA; read-only cache first, then a write queue. Addresses upstream [#79](https://github.com/spliit-app/spliit/issues/79).
- [x] Test coverage for critical flows

### Privacy-respecting AI

- [ ] **Bring-your-own AI for receipt scanning & category** — make the OpenAI client OpenAI-compatible and expose `OPENAI_BASE_URL`, `OPENAI_MODEL`, and `OPENAI_API_KEY` env vars. Unlocks Ollama, LM Studio, OpenRouter, and any other OpenAI-shaped endpoint for self-hosters. Addresses upstream [#309](https://github.com/spliit-app/spliit/issues/309), [#378](https://github.com/spliit-app/spliit/issues/378), [#379](https://github.com/spliit-app/spliit/issues/379), PR [#166](https://github.com/spliit-app/spliit/pull/166), and supersedes the deprecated default model in [#517](https://github.com/spliit-app/spliit/issues/517) (PR [#522](https://github.com/spliit-app/spliit/pull/522)).

### Trust-building bug sweep

These are upstream issues that affect every user of Spliit Cloud too. Each one is a small PR and a meaningful trust return.

- [ ] **Rounding drops a cent when splitting evenly** — upstream [#374](https://github.com/spliit-app/spliit/issues/374), [#375](https://github.com/spliit-app/spliit/issues/375), [#393](https://github.com/spliit-app/spliit/issues/393), fix PR [#427](https://github.com/spliit-app/spliit/pull/427)
- [ ] **"Mark as paid" selects all group members as recipients** — upstream [#197](https://github.com/spliit-app/spliit/issues/197) (2-year-old bug, embarrassingly visible)
- [ ] **`originalAmount` stored as cents** (breaks foreign-currency display & export) — upstream [#513](https://github.com/spliit-app/spliit/issues/513), fix PR [#425](https://github.com/spliit-app/spliit/pull/425)
- [ ] **iOS / German comma-decimal input** — upstream [#528](https://github.com/spliit-app/spliit/issues/528), [#439](https://github.com/spliit-app/spliit/issues/439), fix PR [#531](https://github.com/spliit-app/spliit/pull/531)
- [ ] **"All amounts must be > 0" when editing a category** — upstream [#436](https://github.com/spliit-app/spliit/issues/436)
- [ ] **Exchange rate API redirect strips CORS** — upstream [#514](https://github.com/spliit-app/spliit/issues/514), fix PR [#515](https://github.com/spliit-app/spliit/pull/515)
- [ ] **Keyboard navigation broken in category / currency selectors** — upstream [#491](https://github.com/spliit-app/spliit/pull/491)
- [ ] **CSV export 500 on group names with umlauts** — upstream [#458](https://github.com/spliit-app/spliit/issues/458), fix PR [#377](https://github.com/spliit-app/spliit/pull/377)
- [ ] **Postgres volume mount in modern images** — upstream [#463](https://github.com/spliit-app/spliit/issues/463), fix PR [#464](https://github.com/spliit-app/spliit/pull/464)

## Phase 5: Account customization & settings — planned

### Headline features

- [ ] **Profile photos** — upload and manage profile avatars, displayed in group member lists and expense participants
- [ ] **App theme** — light, dark, and system theme preference persisted per account and synced across devices
- [ ] **Favourite currencies** — user-curated list of preferred currencies that replaces the hardcoded "common currencies" in the expense creation flow. Addresses the steady stream of currency addition PRs by making the selector personal.
- [ ] **Bring-your-own AI key (per-user)** — per-user API key configuration for receipt scanning and category extraction, allowing users to bring their own OpenAI-compatible endpoint and model. Complements the server-level BYOK from Phase 4.
- [ ] **Settings sync across devices** — preferences, favourite currencies, theme, and AI configuration are stored server-side and synced across all sessions. Builds on the account system from Phase 1.

## Cross-cutting

- Server-authoritative currency conversion ([design](./openspec/changes/server-authoritative-currency-conversion)) — addresses upstream [#513](https://github.com/spliit-app/spliit/issues/513) / [#425](https://github.com/spliit-app/spliit/pull/425) and [#514](https://github.com/spliit-app/spliit/issues/514) / [#515](https://github.com/spliit-app/spliit/pull/515)
- **Migrations & imports** — every frustrated Splitwise / Tricount user is a potential customer
  - [ ] Tricount import — PR [#526](https://github.com/spliit-app/spliit/pull/526)
  - [ ] Splitwise (CSV) import — upstream [#22](https://github.com/spliit-app/spliit/issues/22), PR [#483](https://github.com/spliit-app/spliit/pull/483)
- **Self-hosting polish** — turn the README's "self-hosting is supported" into "self-hosting is easy"
  - [ ] Docker Hub published image (CI on tag) — upstream [#60](https://github.com/spliit-app/spliit/issues/60)
  - [ ] `basePath` support for reverse-proxy subpath hosting — upstream [#444](https://github.com/spliit-app/spliit/issues/444)
  - [ ] Default currency env var for self-hosters — upstream [#510](https://github.com/spliit-app/spliit/issues/510)
  - [ ] Simple PIN-protected group access — upstream [#373](https://github.com/spliit-app/spliit/issues/373)
  - [ ] `npm`-free Docker image — PR [#219](https://github.com/spliit-app/spliit/pull/219)
- **Currencies**
  - [ ] Support currencies not in the Frankfurter API (BYO rate or alternate source) — upstream [#449](https://github.com/spliit-app/spliit/issues/449)
  - [ ] Currency framework to absorb the steady stream of "add NPR / MOP / VND / COP / MYR / MKD" PRs — supersedes [#418](https://github.com/spliit-app/spliit/issues/418), [#431](https://github.com/spliit-app/spliit/issues/431), [#438](https://github.com/spliit-app/spliit/issues/438)
- **Integrations / channels**
  - [ ] Telegram notification channel — PR [#252](https://github.com/spliit-app/spliit/pull/252)
  - [ ] Activity feed RSS / Atom export — upstream [#381](https://github.com/spliit-app/spliit/issues/381)
- **Analytics** — turn Spliit from "log splitter" into "money insights"
  - [ ] Pie chart by category — PR [#163](https://github.com/spliit-app/spliit/pull/163)
  - [ ] Monthly category visuals — PR [#532](https://github.com/spliit-app/spliit/pull/532)
  - [ ] Cross-group balance roll-up — upstream [#509](https://github.com/spliit-app/spliit/issues/509)
- Bundle-size reduction (main chunk from ~1500 kB to ~750 kB)
- TypeScript and tooling upgrades
- Weblate translation setup

## Sourcing

The items above are a mix of:

- work already in flight in this repo (recurring, notifications, account overview, direct expenses, server-authoritative currency);
- features the upstream community has been asking for, with linked issues so anyone can verify the demand and history.

When picking up an item with an upstream link, the first step is to review the upstream PR (if any) for prior art and credit the author; if a clean port is feasible on this stack it can land quickly.

## Suggesting items

Open an issue with the user problem, proposed shape, affected capabilities, and any breaking-change implications.

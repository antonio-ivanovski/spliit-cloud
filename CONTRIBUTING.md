# Contributing to Spliit Cloud

Spliit Cloud is a community fork of [Spliit](https://github.com/spliit-app/spliit). Contributions are welcome: bug reports, fixes, tests, docs, translations, and features.

For project rules, see [AGENTS.md](./AGENTS.md). For behavior, see [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).

## Where to start

- [`good first issue`](https://github.com/antonio-ivanovski/spliit-cloud/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) — approachable entry points
- [`help wanted`](https://github.com/antonio-ivanovski/spliit-cloud/issues?q=is%3Aissue+is%3Aopen+label%3A%22help+wanted%22) — scoped but unassigned
- For larger changes, open an issue first to align on direction

## Development setup

Bun monorepo. All commands through Bun.

Local dev runs in three explicit steps:

```bash
bun install
cp .env.example .env
bun dev:up                       # starts postgres, maxio, maildev (compose.dev.yaml)
bun prisma-migrate
bun dev                          # web :3000, api :3001
```

Service state lives under `storage/` at the repository root. Stop local
service containers with `bun dev:down` when you are done; remove `storage/`
for a clean reset.

Other useful commands:

```bash
bun check-types
bun check-formatting
bun run test             # Vitest unit tests
bun test-e2e             # Playwright
```

## Pull request workflow

1. Branch off `main` (`fix/...`, `feat/...`, `docs/...`)
2. One logical change per PR. Add or update tests.
3. Run `bun check-types`, `bun check-formatting`, `bun run test` before pushing.
4. Schema changes: commit schema, migration, and generated client together.
5. Reference the issue with `Closes #123`.

### AI-assisted contributions

AI agent contributions are welcome, but the PR must make the agent's context
and reasoning reviewable. If AI was used, include either:

- the initial prompt and every follow-up prompt that materially shaped the
  implementation, along with any relevant notes about what was accepted or
  changed; or
- for a new feature or a larger chunk of work, a well-defined and up-to-date
  [OpenSpec](https://github.com/Fission-AI/OpenSpec/) describing the proposal,
  design, and implementation tasks. Keep the OpenSpec in sync with the code in
  the PR.

The PR author remains responsible for the implementation, tests, security,
and review of all generated code. Do not include secrets, private data, or
unredacted third-party content in prompt transcripts.

Commit messages: short imperative subject, optional body for the _why_.

## Key rules

From [AGENTS.md](./AGENTS.md):

- Money is integer cents; percentage shares use basis points (`2500` = 25%)
- tRPC procedures stay thin: Zod in, domain/API helpers in
- Import Prisma from `@spliit/db`
- API runs TypeScript directly with Bun — no build step

## Translations

`apps/web/src/messages/en-US.json` is the source of truth. Use `bun i18n` for all changes to non-English locales. Weblate is not set up yet.

## Review

Maintained in spare time. Reviews are best-effort. A ping on stalled PRs is welcome.

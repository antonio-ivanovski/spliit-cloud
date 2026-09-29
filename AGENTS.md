# AGENTS.md

Spliit is a Bun monorepo (web, api, domain, db). Explore `package.json`, workspace packages, and the code for commands, layout, and conventions — do not invent parallel docs.

## Hard rules

- Use Bun, not npm/yarn.
- Do not start `bun dev`, compose (`bun dev:up`), or other long-lived services unless the user explicitly asks.
- Integration tests: never start the API yourself. Web integration needs an existing API on `:3001` — ask the user if it is not running. API `createCaller` tests need the DB only.
- Money is integer cents. `BY_PERCENTAGE` shares are basis points (`2500` = 25%).
- Never hand-edit `apps/web/src/messages/*`. Use `bun i18n` and [`.agents/skills/translate-strings/SKILL.md`](.agents/skills/translate-strings/SKILL.md).
- Prisma migrations: create with `bun --filter @spliit/db prisma-create-migration`. Never invent, backdate, or reuse a `YYYYMMDDHHmmss` folder prefix; the new directory must sort after every existing `packages/db/prisma/migrations/*` folder. See [CONTRIBUTING.md](./CONTRIBUTING.md).

## Done gate (run before reporting done, scoped to touched packages/files)

- Run `check` and address issues. `format` is cheap, just run it; `lint:fix` only auto-fixes some issues, fix the rest manually.
- Affected unit tests (+ `test:integration` files if API logic changed and DB is up; `i18n check --changes-only` if messages changed).

## Parallel agents

- Scope validation to files you touched. If a repo-wide failure is in files you didn't touch, check for active neighbors in your directory (`opencode api session.list`, or for Codex: `find ~/.codex/sessions -type f -mmin -30 -exec grep -l "\"cwd\":\"$PWD\"" {} +`) plus `git status --short`; report it and keep finishing your own work to the best of your ability.
- Only wait or stop if the conflict severely blocks you from finishing. Never `stash`, `reset`, or revert others' changes to green your gate — it undoes their work and they will escalate, making it worse for everyone.

## Gotchas

- No inline `typeof import(...)` types; use top-level `import type`.

## Skills

- Translations: `.agents/skills/translate-strings/SKILL.md`
- User-facing feature and fix work: `.agents/skills/release-notes/SKILL.md`
- Preparing, publishing, or checking a release: `.agents/skills/cut-release/SKILL.md` (pushing a version tag deploys production).

## Environment-specific instructions

- Cursor Cloud agents: [`.agents/cursor-cloud.md`](.agents/cursor-cloud.md) (VM-only startup/run gotchas; not relevant to local development).

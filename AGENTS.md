# AGENTS.md

Spliit is a Bun monorepo (web, api, domain, db). Explore `package.json`, workspace packages, and the code for commands, layout, and conventions — do not invent parallel docs.

## Hard rules

- Use Bun, not npm/yarn.
- Do not start `bun dev`, compose (`bun dev:up`), or other long-lived services unless the user explicitly asks.
- Integration tests: never start the API yourself. Web integration needs an existing API on `:3001` — ask the user if it is not running. API `createCaller` tests need the DB only.
- Money is integer cents. `BY_PERCENTAGE` shares are basis points (`2500` = 25%).
- Never hand-edit `apps/web/src/messages/*`. Use `bun i18n` and [`.agents/skills/translate-strings/SKILL.md`](.agents/skills/translate-strings/SKILL.md).
- Prisma migrations: create with `bun --filter @spliit/db prisma-create-migration`. Never invent, backdate, or reuse a `YYYYMMDDHHmmss` folder prefix; the new directory must sort after every existing `packages/db/prisma/migrations/*` folder. See [CONTRIBUTING.md](./CONTRIBUTING.md).

## Release notes

Rolling releases are created by `.github/workflows/deploy.yml` (`create-release`) via `gh api .../releases/generate-notes` + `.github/release.yml` (previous tag = last `1.*`). Categories map PR labels to sections (`feature`/`feat` → Features, `fix`/`bug` → Fixes, `security`, `chore`, `docs`, else Other Changes). Good hygiene helps: use `feat:`/`fix:`/`chore:`/`docs:` prefixes in commits and PR titles and add the matching label to the PR so the entry lands in the right section. Direct pushes to `main` (no PR) have no label, so they always fall into Other Changes — keep the `feat:`/`fix:` prefix so the line is still readable, or open a PR when you want it categorized. Tags are the full commit SHA (1:1 with `ghcr.io/...:SHA`) plus a moving `rolling` tag.

## Skills

- Translations: `.agents/skills/translate-strings/SKILL.md`

## Environment-specific instructions

- Cursor Cloud agents: [`.agents/cursor-cloud.md`](.agents/cursor-cloud.md) (VM-only startup/run gotchas; not relevant to local development).

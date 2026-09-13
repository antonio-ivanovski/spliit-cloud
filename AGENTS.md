# AGENTS.md

Spliit is a Bun monorepo (web, api, domain, db). Explore `package.json`, workspace packages, and the code for commands, layout, and conventions — do not invent parallel docs.

## Hard rules

- Use Bun, not npm/yarn.
- Do not start `bun dev`, compose (`bun dev:up`), or other long-lived services unless the user explicitly asks.
- Integration tests: never start the API yourself. Web integration needs an existing API on `:3001` — ask the user if it is not running. API `createCaller` tests need the DB only.
- Money is integer cents. `BY_PERCENTAGE` shares are basis points (`2500` = 25%).
- Never hand-edit `apps/web/src/messages/*`. Use `bun i18n` and [`.agents/skills/translate-strings/SKILL.md`](.agents/skills/translate-strings/SKILL.md).
- Prisma migrations: create with `bun --filter @spliit/db prisma-create-migration`. Never invent, backdate, or reuse a `YYYYMMDDHHmmss` folder prefix; the new directory must sort after every existing `packages/db/prisma/migrations/*` folder. See [CONTRIBUTING.md](./CONTRIBUTING.md).

## Releases

Push a `v*.*.*` tag; `.github/workflows/release.yml` publishes images (`:vX.Y.Z` + `:latest`), creates the GitHub Release from `releases/vX.Y.Z.md`, and deploys prod. Write the notes file first — the workflow fails without it.

`releases/next.md` is the evergreen draft: append an entry under the right section for every user-facing change, ending it with ``(`TBD` by @handle)`` — never invent a SHA or handle, the maintainer fills them at cut time with `bun release:prepare vX.Y.Z` (which renames the draft, substitutes `vNEXT`, and lists leftover `TBD`s). Structure the file like Immich releases: welcome line, `## Highlights` (bullet list, then a `###` subsection with screenshot per headline), `## What's Changed` (`### 🚨 Breaking Changes`, `### 🚀 Features`, `### 🐛 Bug fixes`), `**Full Changelog**` compare link. Screenshots go in `releases/assets/next/`, referenced as `./assets/next/<file>`. See `releases/README.md`.

## Skills

- Translations: `.agents/skills/translate-strings/SKILL.md`

## Environment-specific instructions

- Cursor Cloud agents: [`.agents/cursor-cloud.md`](.agents/cursor-cloud.md) (VM-only startup/run gotchas; not relevant to local development).

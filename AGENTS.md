# AGENTS.md

Spliit is a Bun monorepo (web, api, domain, db). Explore `package.json`, workspace packages, and the code for commands, layout, and conventions — do not invent parallel docs.

## Hard rules

- Use Bun, not npm/yarn.
- Do not start `bun dev`, compose (`bun dev:up`), or other long-lived services unless the user explicitly asks.
- Integration tests: never start the API yourself. Web integration needs an existing API on `:3001` — ask the user if it is not running. API `createCaller` tests need the DB only.
- Money is integer cents. `BY_PERCENTAGE` shares are basis points (`2500` = 25%).
- Never hand-edit `apps/web/src/messages/*`. Use `bun i18n` and [`.agents/skills/translate-strings/SKILL.md`](.agents/skills/translate-strings/SKILL.md).

## Skills

- Translations: `.agents/skills/translate-strings/SKILL.md`
- OpenSpec workflows: `.agents/skills/openspec-*/SKILL.md`

## Environment-specific instructions

- Cursor Cloud agents: [`.agents/cursor-cloud.md`](.agents/cursor-cloud.md) (VM-only startup/run gotchas; not relevant to local development).

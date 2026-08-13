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

## Cursor Cloud specific instructions

Standard setup/commands live in `README.md` and `CONTRIBUTING.md` (`bun install`, `bun dev:up`, `bun prisma-migrate`, `bun dev`, `bun run check`, `bun run test`). The startup update script already runs `bun install`; `bun` and Docker are preinstalled in the VM image. The notes below are the non-obvious gotchas specific to this environment (respect the hard rule above: only start `bun dev:up` / `bun dev` when the user asks).

- Docker is NOT auto-started. Before `bun dev:up`, start the daemon once per session: `sudo dockerd > /tmp/dockerd.log 2>&1 &` (wait ~8s). If you hit a docker socket permission error, run `sudo chmod 666 /var/run/docker.sock`.
- Local `.env` (create with `cp .env.example .env`): the committed `.env.example` ships values that FAIL the API/worker/MCP Zod env validation at boot. For local dev, blank these in `.env`: `MCP_PUBLIC_URL`, `MCP_API_URL`, `MCP_WEB_URL` (they default to `cloudflared ...` command strings, not URLs) and `PUSH_VAPID_SUBJECT` (set while the VAPID key pair is empty → "must be configured together"). All are optional for core flows.
- `bun dev:up` bind-mounts `./storage/*` into the containers. The freshly-created `storage/maildev` and `storage/maxio` are root-owned, but maildev runs as uid 1000 and maxio as uid 999, so maxio comes up unhealthy (fails the `--wait`) and maildev crashes on every received email ("Connection closed unexpectedly", so no verification/notification emails arrive). Fix after `bun dev:up`: `sudo chown -R 999:999 storage/maxio && sudo chown -R 1000:1000 storage/maildev && docker restart spliit-maxio spliit-maildev`. Repeat after any `rm -rf storage/` reset.
- Running the app: `bun dev` also starts the optional MCP app (`@spliit/mcp`), which cannot boot without real public tunnel (cloudflared) URLs; because turbo `dev` tasks are persistent, its startup failure aborts the whole run. Run web+api+worker only with `bunx turbo run dev --filter='!@spliit/mcp'` (single-quote the filter so bash does not history-expand `!`). Ports: web `:3000`, api `:3001`, worker admin `:3003`. To also run MCP, set valid `MCP_PUBLIC_URL`/`MCP_API_URL`/`MCP_WEB_URL`.
- Signup requires email verification (`requireEmailVerification: true`); open/click the verification link in MailDev at http://localhost:1080. Other local UIs: MaxIO S3 at http://localhost:9000/ui/, pg-boss dashboard at http://localhost:3004, API health at http://localhost:3001/health/readiness.
- Formatting (`oxfmt`, used by `bun run check` / `check-formatting` / `format`) loads `oxfmt.config.ts` via Node's TS support and needs Node ≥ 22.18.0. The daemon's default `node` on `PATH` (`/exec-daemon/node`) is older and makes those commands fail with "TypeScript config files require Node.js …". A newer Node (22.22.2) is installed via nvm; prepend it before running formatting, e.g. `PATH="$HOME/.nvm/versions/node/v22.22.2/bin:$PATH" bun run check`. `oxlint`/`tsc`/`vitest`/build/dev are unaffected.

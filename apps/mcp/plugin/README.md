# Spliit Cloud ChatGPT plugin package

Source of truth for the OpenAI Platform plugin submission ZIP. The dashboard
reads listing, review, and publication details from `plugin.json` on upload;
reviewer credentials are entered separately in the dashboard and must never be
committed here.

## Layout (Agent Plugins format)

- `plugin.json` — package identity, listing (`extensions.com.openai.interface`),
  onboarding skill, review cases, publication notes.
- `mcp.json` — the single MCP server (`spliit`). Only one MCP server can be
  connected per plugin.
- `skills/get-started/SKILL.md` — onboarding skill referenced by `plugin.json`.
- `assets/` — square `logo` / `composerIcon` SVGs (+ dark variants).

## Build the submission ZIP

```bash
cd apps/mcp/plugin
zip -r spliit-chatgpt-plugin.zip plugin.json mcp.json skills assets
```

Upload the ZIP at Platform → Plugins → Upload new or existing plugin, then
open **MCPs**, connect the server, complete the domain-verification challenge
(see below), and wait for the tool scan before submitting.

## Before every submission

1. **MCP URL.** `mcp.json` points at `https://mcp.spliit.cloud/mcp`. It must
   match the deployed `MCP_PUBLIC_URL` plus `/mcp`. The update flow does not
   support URL changes — contact support if the URL ever needs to change.
2. **Domain verification.** The dashboard shows a fresh challenge token per
   submission. Set it as `OPENAI_APPS_CHALLENGE` in the MCP deployment (Dokploy
   `.env`) and redeploy, then verify:
   `curl https://mcp.spliit.cloud/.well-known/openai-apps-challenge`
   must return exactly that token as `text/plain`.
3. **Demo video.** `review.demo_recording_url` is still the
   `example.com` placeholder. Record the five positive and three negative
   cases with the reviewer test account and replace it.
4. **Reviewer account.** Provision a pre-verified, password-based account with
   sample groups/expenses (see `docs/mcp-publishing.md`), and enter its
   login, login URL, and instructions in the dashboard Review details form —
   never in this package.
5. **Version.** Bump `version` in `plugin.json` (currently `1.0.1`) and update
   `publication.release_notes` for every resubmission.

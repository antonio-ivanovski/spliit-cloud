# Publishing the Spliit Cloud MCP App

This guide starts after the Spliit Cloud web app, API, and MCP service have been
deployed to stable public HTTPS domains. Replace the example domains throughout:

- Web: `https://app.spliit.example`
- API and OAuth issuer: `https://api.spliit.example`
- MCP server: `https://mcp.spliit.example`
- MCP endpoint: `https://mcp.spliit.example/mcp`

ChatGPT is the primary release target. Claude uses the same MCP endpoint and
OAuth flow.

For local Inspector-only testing, portless HTTPS names are sufficient. For
ChatGPT or Claude, the MCP, API, and web services must each have public HTTPS
origins. Start one tunnel per service (portless serves local HTTPS, so pass
`--no-tls-verify`):

```bash
cloudflared tunnel --url https://mcp.spliit.localhost --no-tls-verify  # MCP
cloudflared tunnel --url https://api.spliit.localhost --no-tls-verify  # API
cloudflared tunnel --url https://spliit.localhost --no-tls-verify      # Web
```

For local development, run the MCP server manually (it is not part of
`bun dev`): `bun --filter @spliit/mcp dev:mcp` (served at
`https://mcp.spliit.localhost`; plain-port bypass
`PORTLESS=0 bun --filter @spliit/mcp dev:mcp` listens on
`http://localhost:3002`).

## 1. Configure production

Set these values in the Dokploy Compose environment:

```dotenv
MCP_PUBLIC_URL=https://mcp.spliit.example
MCP_API_URL=https://api.spliit.example
MCP_WEB_URL=https://app.spliit.example

BETTER_AUTH_URL=https://api.spliit.example
WEB_ORIGINS=https://app.spliit.example
VITE_API_URL=https://api.spliit.example

# Generate once with: openssl rand -hex 32
ASSISTANT_CONFIRMATION_SECRET=replace-with-at-least-32-random-bytes

# Fresh token per OpenAI plugin submission (Platform dashboard → MCPs →
# domain verification). Leave empty until the first submission; the server
# serves the previous submission's token as a fallback.
OPENAI_APPS_CHALLENGE=
```

The old `MCP_URL`, `SPLIIT_API_URL`, and `SPLIIT_WEB_URL` names are not
backwards-compatible; replace them in Dokploy rather than keeping both sets.

Keep these invariants:

1. `MCP_PUBLIC_URL` is an origin without `/mcp`.
2. The connector URL entered into ChatGPT or Claude is `MCP_PUBLIC_URL` plus `/mcp`.
3. `MCP_API_URL` and `BETTER_AUTH_URL` identify the same public API origin.
   OAuth issuer and JWKS validation fail if internal and public API URLs differ.
4. `MCP_WEB_URL` is the public web origin that hosts `/oauth/login` and
   `/oauth/consent`.
5. `ASSISTANT_CONFIRMATION_SECRET` is private, stable across API replicas and
   deployments, and at least 32 bytes.
6. `OPENAI_APPS_CHALLENGE` holds the current OpenAI domain-verification token.
   The dashboard issues a fresh token per submission; after setting it,
   redeploy and confirm
   `https://mcp.spliit.example/.well-known/openai-apps-challenge` returns
   exactly that token as `text/plain`.

In Dokploy:

1. Add a domain for the `mcp` Compose service.
2. Route it to container port `3002`.
3. Enable HTTPS.
4. Deploy the Compose application. The migration must complete, then the API
   must become healthy before the MCP service starts.
5. Do not place an authentication proxy in front of the MCP domain. Spliit Cloud's
   OAuth bearer flow protects `/mcp`.

## 2. Run production preflight checks

Check the service itself:

```bash
curl --fail https://mcp.spliit.example/health
```

Expected response:

```json
{ "status": "ok" }
```

Check the protected resource metadata:

```bash
curl --fail \
  https://mcp.spliit.example/.well-known/oauth-protected-resource
```

It must advertise:

- `resource`: `https://mcp.spliit.example/mcp`
- `authorization_servers`: `https://api.spliit.example/auth`
- both Spliit Cloud scopes

Check OAuth discovery and dynamic client registration:

```bash
curl --fail \
  https://api.spliit.example/.well-known/oauth-authorization-server

curl --fail \
  https://api.spliit.example/.well-known/openid-configuration
```

The metadata must contain a `registration_endpoint`, PKCE support, and
`offline_access` in `scopes_supported`.

Finally, verify that an unauthenticated MCP request is challenged rather than
served as a web page:

```bash
curl --include \
  --request POST \
  --header 'content-type: application/json' \
  --header 'accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"preflight","version":"1.0.0"}}}' \
  https://mcp.spliit.example/mcp
```

Expected: HTTP `401` with a `WWW-Authenticate` header pointing to the protected
resource metadata.

Before using either host, connect with MCP Inspector and complete OAuth:

```bash
bunx @modelcontextprotocol/inspector@latest
```

Use `https://mcp.spliit.example/mcp` as the Streamable HTTP endpoint. Confirm
that the three model-facing tools are discovered (`get-expense-context`,
`get-group-summary`, `prepare-expense`; `create-expense` is widget-only and
`add-spliit-expense` is a prompt), read tools only expose the signed-in
account, `prepare-expense` renders the widget, and the widget button creates
exactly one expense.

## 3. Add and test in ChatGPT

OpenAI currently requires a remote public HTTPS MCP endpoint. The complete
Spliit Cloud flow, including the widget's write action, currently requires ChatGPT
Business, Enterprise, or Edu on the web. Pro developer mode supports
read/fetch MCP access, so it cannot complete expense creation.

1. Sign in to ChatGPT on the web.
2. Enable Developer mode:
   - Business admins/owners can use **Workspace Settings → Apps → Create**, or
     **Settings → Apps → Advanced Settings → Developer mode**.
   - Enterprise/Edu admins first grant access under **Workspace Settings →
     Permissions & Roles → Connected Data**. The authorized user then enables
     **Settings → Apps → Advanced Settings → Developer mode**.
3. Open **Settings → Apps → Create** (admins/owners may instead use
   **Workspace Settings → Apps → Create**).
4. Select the add/create button.
5. Enter:
   - Name: `Spliit`
   - Description: `Create and review shared expenses from conversation.`
   - MCP server URL: `https://mcp.spliit.example/mcp`
6. Choose OAuth when ChatGPT asks for authentication.
7. Select **Scan tools** or create the connection.
8. Complete **Sign in with Spliit**, verify the account shown on the consent
   page, review the scopes, and select **Allow and connect**.
9. Confirm that ChatGPT discovers:
   - `get-expense-context`
   - `get-group-summary`
   - `prepare-expense`
   - the private widget-only `create-expense` action
10. Start a new chat, enable Spliit from the tools menu, and test:
    - `Add $50 for bar drinks and pizza to Portugal, split evenly.`
    - a named-participant split
    - a foreign-currency expense
    - a receipt image with item assignments
11. Verify that ChatGPT calls `prepare-expense`, displays the non-editable
    preview, and does not claim the expense exists until the preview button
    succeeds.

### Publish inside a ChatGPT workspace

For Business/Enterprise/Edu:

1. Test the draft app with representative read and write cases.
2. As a workspace Admin or Owner, open
   **Workspace Settings → Apps → Drafts**.
3. Select Spliit and choose **Publish**.
4. Review the write-action warning.
5. On Enterprise/Edu, configure allowed actions and workspace groups before
   publishing.

ChatGPT freezes the approved tool/schema snapshot. After changing tool names,
schemas, annotations, or metadata, an admin must refresh/review the actions.
Business workspaces may require recreating and republishing the app.

### Submit for public ChatGPT discovery

Workspace publication is not public directory publication. For a public
listing, submit the plugin package from this repo (source of truth:
[`apps/mcp/plugin/`](../apps/mcp/plugin/), packaging checklist in its
`README.md`):

1. In the OpenAI Platform organization, verify the individual or business
   identity that will publish Spliit.
2. Ensure the submitter has **Apps Management: Write**.
3. Bump `version` in `apps/mcp/plugin/plugin.json`, update
   `publication.release_notes`, and replace the `example.com` demo-video
   placeholder with a recording of the review cases below.
4. Build the ZIP (`cd apps/mcp/plugin && zip -r spliit-chatgpt-plugin.zip
plugin.json mcp.json skills assets`) and upload it at
   [Plugins](https://platform.openai.com/plugins) via **Upload new or
   existing plugin**. Keep secrets out of the ZIP.
5. Open **MCPs**, connect the `spliit` server at
   `https://mcp.spliit.example/mcp`, complete the domain-verification
   challenge (set the shown token as `OPENAI_APPS_CHALLENGE` and redeploy),
   and wait for the automated tool scan. Resolve every required finding
   (metadata findings need a corrected ZIP + re-upload; tool findings need a
   server fix + **Rescan**).
6. Fill **Review information → Review details**: reviewer login + password,
   login URL (`https://spliit.cloud/oauth/login` is reached automatically
   through the OAuth flow; describe it), and sign-in instructions. The
   OAuth login screen defaults to the password tab with no inbox step.
7. Submit for review, respond to feedback by email, and choose **Publish
   plugin** after approval.

#### Reviewer account runbook

Reviewer credentials are the highest-risk item: the account must work on the
first try with no extra steps. Provision a dedicated, pre-verified email+password account
— never a new sign-up, magic link, or social login — and keep it alive for
re-reviews:

- Verified email, password sign-in, no MFA, no email/SMS codes.
- Populated with sample groups (including a `Portugal` group), participants,
  balances, and recent expenses matching the five positive test cases in
  `plugin.json`.
- Sign-in smoke test in a clean browser: DCR → `/oauth/login` (password tab
  first, no guest option) → `/oauth/consent` (account + scopes shown) →
  token → refresh → all tools.
- Credentials live only in the dashboard Review details form and the
  operator's password manager — never in the repo or the ZIP.

Review the current
[OpenAI submission flow](https://developers.openai.com/plugins/deploy/submission)
and
[plugin guidelines](https://developers.openai.com/plugins/plugin-guidelines)
immediately before submitting.

## 4. Add and test in Claude

Claude supports Streamable HTTP, OAuth DCR, token refresh, tools, prompts,
resources, and MCP Apps.

For an individual Pro or Max account:

1. Open Claude or Claude Desktop.
2. Go to **Settings → Connectors**.
3. Select **Add custom connector**.
4. Enter:
   - Name: `Spliit`
   - URL: `https://mcp.spliit.example/mcp`
5. Select **Add**, then **Connect**.
6. Complete the Spliit Cloud OAuth login and consent flow.
7. In a new conversation, open **Search and tools**, enable Spliit, and run the
   same test prompts used for ChatGPT.

For Team or Enterprise, an Owner/Primary Owner adds the connector under
**Settings → Connectors → Organization connectors**. Each user then connects
their own Spliit Cloud account.

A prefilled installation link can be shared from Spliit Cloud documentation:

```text
https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=Spliit&connectorUrl=https%3A%2F%2Fmcp.spliit.example%2Fmcp
```

### Submit to the Claude Connectors Directory

Public Claude directory publication requires a Team or Enterprise organization
and directory-management access:

1. Prepare public documentation, privacy policy, support contact, icon, and a
   populated reviewer test account.
2. Capture 3–5 PNG screenshots of the MCP App response at least 1000 pixels
   wide; include the paired prompt text separately.
3. Confirm every tool has a title and correct read/write annotations.
4. Open the connector submission portal from Claude.ai admin settings.
5. Connect `https://mcp.spliit.example/mcp` using Streamable HTTP.
6. Review the automatically discovered tools, prompts, resources, and
   annotations.
7. Complete the listing, use cases, company, OAuth, data handling, reviewer
   access, and compliance sections.
8. Run every tool through Claude or MCP Inspector, then submit.
9. Track status and reviewer feedback in the submissions dashboard.

Use Anthropic's current
[directory submission guide](https://claude.com/docs/connectors/building/submission)
and
[pre-submission checklist](https://claude.com/docs/connectors/building/review-criteria)
as the source of truth.

## 5. Release checklist

Before announcing either integration:

- OAuth discovery, DCR, PKCE, refresh tokens, and JWKS work from a clean browser.
- Consent identifies both the Spliit Cloud account and assistant client.
- Two different Spliit Cloud accounts cannot see each other's groups or participants.
- Browser visits to the production MCP/inspector routes do not expose a
  dashboard.
- A flat, FX, and itemized expense preview render in ChatGPT and Claude.
- Only the widget button can call the private create tool.
- Expired/tampered previews fail safely.
- Repeated and concurrent confirmation produces one expense.
- Logs contain no access token, confirmation token, notes, participant payload,
  or balance payload.
- Privacy policy, terms, support contact, and reviewer account are ready.

# Publishing the Spliit MCP App

This guide starts after the Spliit web app, API, and MCP service have been
deployed to stable public HTTPS domains. Replace the example domains throughout:

- Web: `https://app.spliit.example`
- API and OAuth issuer: `https://api.spliit.example`
- MCP server: `https://mcp.spliit.example`
- MCP endpoint: `https://mcp.spliit.example/mcp`

ChatGPT is the primary release target. Claude uses the same MCP endpoint and
OAuth flow.

For local Inspector-only testing, localhost values are sufficient. For
ChatGPT or Claude, the MCP, API, and web services must each have public HTTPS
origins. Start one tunnel per service:

```bash
cloudflared tunnel --url http://localhost:3002  # MCP
cloudflared tunnel --url http://localhost:3001  # API
cloudflared tunnel --url http://localhost:3000  # Web
```

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

In Dokploy:

1. Add a domain for the `mcp` Compose service.
2. Route it to container port `3002`.
3. Enable HTTPS.
4. Deploy the Compose application. The migration must complete, then the API
   must become healthy before the MCP service starts.
5. Do not place an authentication proxy in front of the MCP domain. Spliit's
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
  https://mcp.spliit.example/.well-known/oauth-protected-resource/mcp
```

The origin-level `/.well-known/oauth-protected-resource` compatibility alias
advertises the same resource for older hosts.

It must advertise:

- `resource`: `https://mcp.spliit.example/mcp`
- `authorization_servers`: `https://api.spliit.example/auth`
- both Spliit scopes

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
that the four tools are discovered, read tools only expose the signed-in
account, `prepare-expense` renders the widget, and the widget button creates
exactly one expense.

## 3. Add and test in ChatGPT

OpenAI currently requires a remote public HTTPS MCP endpoint. The complete
Spliit flow, including the widget's write action, currently requires ChatGPT
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
listing:

1. In the OpenAI Platform organization, verify the individual or business
   identity that will publish Spliit.
2. Ensure the submitter has **Apps Management: Write**.
3. Prepare the name, descriptions, logo, category, website, support URL,
   privacy policy, terms, starter prompts, at least five positive and three
   negative test cases, country availability, demo account, and MCP/OAuth
   instructions. Reviewer credentials must work without MFA, SMS, email
   confirmation, or private-network access.
4. Open the
   [OpenAI plugin submission portal](https://platform.openai.com/apps-manage).
5. Create an MCP-backed plugin submission and provide
   `https://mcp.spliit.example/mcp`.
6. Complete domain verification and the automated server scan.
7. Supply reviewer credentials for a populated Spliit test account.
8. Submit, respond to review feedback, and publish after approval.

Review the current
[OpenAI submission flow](https://developers.openai.com/plugins/deploy/submission)
and
[MCP server review requirements](https://developers.openai.com/plugins/deploy/app-review)
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
6. Complete the Spliit OAuth login and consent flow.
7. In a new conversation, open **Search and tools**, enable Spliit, and run the
   same test prompts used for ChatGPT.

For Team or Enterprise, an Owner/Primary Owner adds the connector under
**Settings → Connectors → Organization connectors**. Each user then connects
their own Spliit account.

A prefilled installation link can be shared from Spliit documentation:

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
- Consent identifies both the Spliit account and assistant client.
- Two different Spliit accounts cannot see each other's groups or participants.
- Browser visits to the production MCP/inspector routes do not expose a
  dashboard.
- A flat, FX, and itemized expense preview render in ChatGPT and Claude.
- Only the widget button can call the private create tool.
- Expired/tampered previews fail safely.
- Repeated and concurrent confirmation produces one expense.
- Logs contain no access token, confirmation token, notes, participant payload,
  or balance payload.
- Privacy policy, terms, support contact, and reviewer account are ready.

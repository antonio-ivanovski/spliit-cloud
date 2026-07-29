# Spliit Assistant MCP App

Portable MCP Apps server for ChatGPT and Claude. It authenticates against
Spliit Cloud's Better Auth OAuth 2.1 provider, forwards the user's access token
to the scoped assistant tRPC router, and renders a non-editable expense preview.

For production deployment, ChatGPT publication, and Claude publication, see
[`docs/mcp-publishing.md`](../../docs/mcp-publishing.md).
The post-implementation findings and follow-up recommendations are in
[`docs/mcp-implementation-review.md`](../../docs/mcp-implementation-review.md).

## Expense workflow

The model-facing workflow is intentionally short:

1. `get-expense-context` returns the complete authorized context needed to
   prepare an expense: the connected Spliit account name, groups, eligible
   participants, caller participant IDs, currencies, disambiguation labels,
   and valid category catalog.
2. Resolve group and participant names case-insensitively from that response.
   Use `get-group-summary` only for balances, recent expenses, or deeper group
   context.
3. `prepare-expense` validates the request and returns the interactive,
   non-editable confirmation card. It does not write anything.
4. The card's **Create expense** button calls the app-only `create-expense`
   tool. The model cannot call that tool directly or modify the sealed payload.

The assistant should call `get-expense-context` and `prepare-expense` in the
same turn whenever the request is unambiguous. It selects the closest valid category when
the description clearly indicates one and otherwise uses General. Omitted
payer, split, date, category, and currency use Spliit defaults. A
different supported ISO expense currency is converted to the group currency
with Spliit's server-side rate for the expense date. The resolved rate is sealed
into the 15-minute confirmation so creation persists exactly what was previewed.
A bare `$` means the group currency when it is a dollar currency; otherwise it
means USD.

If separate groups have the same display name, `get-expense-context` returns a
`disambiguationLabel` containing the group type and a short stable ID. Exact
duplicate rows are removed. The assistant should ask a short clarification only
when multiple distinct group IDs remain plausible.

## Itemized receipts

ChatGPT or Claude may inspect a receipt image in the conversation and pass
structured `items` to `prepare-expense`. Each item has a title, unit price,
quantity, and an optional EVENLY, BY_SHARES, BY_PERCENTAGE, or BY_AMOUNT split.
For example, “Alex had 2 beers and Alice had 3” maps naturally to shares 2 and
3 for the beer line.

The assistant must ask one focused question when the receipt total, currency,
or line items are unreadable or contradictory; it must not invent values.
Unassigned items use the saved group split when valid, otherwise an even split.
Tax, tip, or another remainder can have an explicit split, or Spliit allocates
it proportionally to exact item subtotals. The preview shows every item,
allocation, remainder, and aggregate participant total before creation.

Receipt image bytes are not accepted or stored by this MCP app. Image
interpretation remains in the host assistant, which keeps the flow portable
between ChatGPT and Claude.

## Configuration

- `MCP_PUBLIC_URL`: public origin of this service, for example `https://mcp.example.com`
- `MCP_API_URL`: public Spliit API origin used by the MCP server
- `MCP_WEB_URL`: public Spliit web origin used by expense links

These three variables are required by the MCP process. It validates them before
constructing the server or binding its port, so `dev` and production `start`
exit immediately when one is absent or malformed. The Docker Compose service
also uses required-variable checks and will not create the MCP container when
one is missing.

The previous `MCP_URL`, `SPLIIT_API_URL`, and `SPLIIT_WEB_URL` names are no
longer read. Rename them in local `.env` files and deployment secrets before
starting the updated server.

The API must use the same `MCP_PUBLIC_URL` as the OAuth audience. The API separately
configures `BETTER_AUTH_URL`, `WEB_ORIGINS`, and a dedicated
`ASSISTANT_CONFIRMATION_SECRET` of at least 32 bytes. The confirmation secret
is API-only; it is deliberately not passed to the MCP service.

The expense widget reuses `MCP_PUBLIC_URL` as its unique submitted widget
domain. Production startup writes that origin into the built widget manifest
before mcp-use mounts the resources, so no separate widget-domain environment
variable or deployment is required.

For a remote assistant host, these origins must be public HTTPS URLs:

- MCP endpoint: `MCP_PUBLIC_URL` (`MCP_PUBLIC_URL/mcp` is the connector URL)
- API/OAuth: `MCP_API_URL` and `BETTER_AUTH_URL` (the same origin)
- Web/OAuth UI: `MCP_WEB_URL`, `WEB_ORIGINS`, and `VITE_API_URL`

Database, SMTP, storage, Better Auth secrets, and
`ASSISTANT_CONFIRMATION_SECRET` remain private local or server-side settings.

## Commands

Use Bun from the repository root:

```bash
bun install
bun --cwd apps/mcp run check-types
bun --cwd apps/mcp run build
```

For local interactive validation, start the existing API and web app separately,
then run `bun --cwd apps/mcp dev`. The development server listens on port 3002,
and MCP clients connect to `/mcp`. Do not point a public assistant host at
localhost; use HTTPS deployments or secure development tunnels for the MCP,
API, and web origins used during OAuth.

The local Inspector is different: it runs in your browser and can use
`http://localhost:3002/mcp` with localhost API/web values. ChatGPT and Claude
run outside your machine, so they need public HTTPS origins for all three
services.

## Inspector

After starting the web app, API, and MCP server, open:

```text
http://localhost:3002/inspector
```

Connect to `http://localhost:3002/mcp`. The first initialization request returns
401 by design; use the Inspector's authentication action to complete the Spliit
login and consent flow. If OAuth metadata or URLs changed, restart the MCP
server and clear the Inspector's saved connection before reconnecting.

To verify the UI:

1. List tools and confirm `prepare-expense` contains both
   `_meta.ui.resourceUri` and `openai/outputTemplate`.
2. Call `get-expense-context`, copy one returned group ID, and call
   `prepare-expense` with `groupId`, `amount`, and `title`.
3. The result should render the expense card. `create-expense` is app-only, so
   it is intentionally absent from the model-facing tool list while remaining
   callable by the card.

If a host responds with prose instead of calling `prepare-expense`, remove and
re-add the connector after deploying the latest MCP build; ChatGPT and Claude
may cache tool descriptions and widget resource URIs from the connection.

## Public assistant hosts

ChatGPT and Claude require every URL involved in OAuth to be publicly reachable.
For tunneled development, run these in separate terminals:

```bash
cloudflared tunnel --url http://localhost:3002  # MCP
cloudflared tunnel --url http://localhost:3001  # API
cloudflared tunnel --url http://localhost:3000  # Web
```

Copy the three `https://*.trycloudflare.com` URLs printed by cloudflared into
the corresponding settings below:

```dotenv
MCP_PUBLIC_URL=https://mcp-example.trycloudflare.com
MCP_API_URL=https://api-example.trycloudflare.com
MCP_WEB_URL=https://web-example.trycloudflare.com
BETTER_AUTH_URL=https://api-example.trycloudflare.com
WEB_ORIGINS=https://web-example.trycloudflare.com
VITE_API_URL=https://api-example.trycloudflare.com
```

The connector URL is `MCP_PUBLIC_URL/mcp`. The API tunnel is needed for OAuth
discovery, JWKS, login, consent, and MCP-to-API requests. The web tunnel is
needed for the consent/login pages and links opened from previews.

Restart all services after changing these values, then configure the assistant
with `https://mcp.example.test/mcp`.

After rebuilding or changing tool/widget metadata, restart the MCP deployment
and reconnect the host so it fetches the new tool list and versioned widget
resource.

# Spliit auth.md — agent registration and authentication

This document is for AI agents and programmatic clients (scripts, CLIs,
external apps) that need to act on a Spliit account. Humans sign in with
email/password, magic link, or Google/GitHub/X in the browser; agents use
OAuth 2.1 against the API's own authorization server instead of a browser
session.

Base URLs:

- Web app: `https://spliit.cloud`
- API and authorization server: `https://api.spliit.cloud`
- Machine-readable API catalog: https://spliit.cloud/.well-known/api-catalog
  (RFC 9727; points at the OpenAPI spec, docs, and health endpoint)

## Discover OAuth metadata

Start from the protected-resource document (RFC 9728), also mirrored on the
web origin for discovery:

- https://api.spliit.cloud/.well-known/oauth-protected-resource
- https://spliit.cloud/.well-known/oauth-protected-resource (proxied)

It carries `resource`, `authorization_servers`, `scopes_supported`, and
`bearer_methods_supported: ["header"]`. Follow the advertised authorization
server through RFC 8414 discovery:

- https://api.spliit.cloud/.well-known/oauth-authorization-server
- https://api.spliit.cloud/.well-known/openid-configuration

The server document lists `issuer`, `authorization_endpoint`, `token_endpoint`,
`jwks_uri`, `grant_types_supported: ["authorization_code", "refresh_token"]`,
and `response_types_supported: ["code"]`.

## Machine-readable agent metadata

The authorization server advertises the registration surface in an `agent_auth`
block; the live document is authoritative:

- https://api.spliit.cloud/.well-known/oauth-authorization-server/auth

```json
{
  "agent_auth": {
    "skill": "https://spliit.cloud/auth.md",
    "register_uri": "https://api.spliit.cloud/auth/oauth2/register",
    "revocation_uri": "https://api.spliit.cloud/auth/oauth2/revoke",
    "identity_types_supported": ["service_auth"],
    "service_auth": {
      "credential_types_supported": ["access_token"]
    }
  }
}
```

`service_auth` is the only supported registration method: the agent registers
an OAuth client, then the account holder completes the ceremony in the browser
(sign-in and scope consent). There is no ID-JAG (`identity_assertion`) path and
no anonymous credential issuance — the API never issues credentials without the
account holder approving them.

## Registration method

Supported method: `service_auth` — standard OAuth 2.1 with dynamic client
registration (open, no pre-provisioning) and the account holder's browser
consent. One complete method:

1. Register (public clients use `token_endpoint_auth_method: "none"` with
   PKCE `S256`):

```bash
curl -X POST https://api.spliit.cloud/auth/oauth2/register \
  -H 'Content-Type: application/json' \
  -d '{
    "client_name": "My agent",
    "redirect_uris": ["http://127.0.0.1:52123/callback"],
    "token_endpoint_auth_method": "none",
    "grant_types": ["authorization_code", "refresh_token"],
    "response_types": ["code"]
  }'
```

The response returns the `client_id`. To request write access, send the full
space-separated `scope` set at registration (an explicit value replaces the
defaults, it does not add to them).

2. Authorize: send the account holder to
   `https://api.spliit.cloud/auth/oauth2/authorize` with `response_type=code`,
   `client_id`, `redirect_uri`, `scope`, `state`, `code_challenge`, and
   `code_challenge_method=S256`. They sign in and approve the scopes.

3. Token exchange (form-encoded):

```bash
curl -X POST https://api.spliit.cloud/auth/oauth2/token \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'grant_type=authorization_code' \
  --data-urlencode 'client_id=<client_id>' \
  --data-urlencode 'code=<authorization_code>' \
  --data-urlencode 'redirect_uri=http://127.0.0.1:52123/callback' \
  --data-urlencode 'code_verifier=<pkce_code_verifier>'
```

Refresh with `grant_type=refresh_token`. Access tokens last at most one hour;
refresh tokens last 30 days, rotate on every use, and a monthly refresh keeps
the grant alive indefinitely. Refresh tokens are single-use: persist the
rotated pair before retrying. Refreshing cannot widen scopes — re-run the
authorization flow for step-up.

## Scopes and credential use

| Scope                    | Covers                                      |
| ------------------------ | ------------------------------------------- |
| `spliit:groups:read`     | groups, balances, statistics, activity      |
| `spliit:groups:manage`   | create and edit groups, add participants    |
| `spliit:groups:delete`   | delete or archive a group, remove members   |
| `spliit:expenses:read`   | expenses and recurring series               |
| `spliit:expenses:manage` | create and edit expenses, stop a recurrence |
| `spliit:expenses:delete` | delete an expense, and edits that drop data |

A client that registers without naming scopes gets the two read scopes plus
`openid profile email offline_access` only. Write and delete scopes are never
granted by default and must be requested by name. Managing or deleting implies
reading the same resource.

Use the credential as a header on every API call (tRPC under `/trpc` with
dotted procedure names; see `https://api.spliit.cloud/docs`):

```bash
curl -G 'https://api.spliit.cloud/trpc/groups.list' \
  -H "Authorization: Bearer <access_token>" \
  --data-urlencode 'input={"json":{}}'
```

Machine-actionable `WWW-Authenticate` challenges tell you what to do next:
no token yields the required `scope` plus `resource_metadata`; an expired or
wrong-audience token yields `error="invalid_token"` (refresh or re-authorize);
a valid token missing a scope yields `error="insufficient_scope"` with the
exact scope to step up to.

Revocation: `POST https://api.spliit.cloud/auth/oauth2/revoke` ends a single
token; disconnecting the app in account settings ends the whole grant at once
(pending codes, refresh lineage, and issued access tokens).

Note: tokens minted for the MCP assistant resource are a separate audience
and are not valid on the direct API, and vice versa (RFC 8707).

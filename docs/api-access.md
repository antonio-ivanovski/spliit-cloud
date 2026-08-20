# Programmatic API access

Scripts and agents reach the API with an OAuth 2.1 access token instead of a
browser session. The authorization server runs on the API itself, so nothing
extra needs to be deployed: no MCP server, no feature flag.

The interactive reference is at [`/docs`](https://api.spliit.cloud/docs) and the
machine-readable document at
[`/openapi.json`](https://api.spliit.cloud/openapi.json). Both list the scope
each operation accepts.

## Scopes

Access is granted per resource and per verb.

| Scope                    | Covers                                         |
| ------------------------ | ---------------------------------------------- |
| `spliit:groups:read`     | groups, balances, statistics, activity         |
| `spliit:groups:write`    | create and edit groups, add participants       |
| `spliit:groups:delete`   | delete or archive a group, remove participants |
| `spliit:expenses:read`   | expenses and recurring series                  |
| `spliit:expenses:write`  | create and edit expenses, stop a recurrence    |
| `spliit:expenses:delete` | delete an expense                              |

A client that registers without naming scopes receives the four read and write
scopes. **The two delete scopes are never granted by default** and must be
requested explicitly, so an agent cannot destroy anything unless you decided it
should be able to.

Write implies read: a token holding `spliit:expenses:write` can read expenses
without also holding `spliit:expenses:read`.

Scopes bound what a token may attempt, not who the caller is. Group role rules
still apply on top: a token acting for a non-admin member can only delete
expenses that member created.

## Registering a client

Dynamic client registration is open, so a client can enrol itself:

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

The response returns the `client_id` to use below.

Add a `scope` field to request a delete scope. This has to happen at
registration: the authorization endpoint refuses any scope the client did not
register for, with `The following scopes are invalid`. There is no endpoint to
widen an existing client, so a client that needs to start deleting has to be
registered again and reauthorized.

```bash
  -d '{
    "client_name": "My agent",
    ...
    "scope": "openid offline_access spliit:expenses:read spliit:expenses:write spliit:expenses:delete"
  }'
```

## Getting a token

The authorization code flow with PKCE, which needs a browser once:

1. Send the account holder to `/auth/oauth2/authorize` with `response_type=code`,
   your `client_id`, `redirect_uri`, `scope`, `state`, `code_challenge`,
   `code_challenge_method=S256` and `resource=https://api.spliit.cloud`.
2. They sign in and approve the scopes.
3. Exchange the returned `code` at `/auth/oauth2/token` with `grant_type=authorization_code`,
   your `code_verifier` and the same `resource`.

`resource` names the server the token is minted for, and it is not optional
here. Omit it and the authorization server issues an opaque token instead of a
JWT, which the API rejects with a plain `401`. Pass it on the refresh call too.

Tokens issued for the MCP resource (`${MCP_PUBLIC_URL}/mcp`) are also accepted
while that variable is configured, so clients set up before the API became its
own resource server keep working without reauthorizing.

Call the API with `Authorization: Bearer <access_token>`.

Access tokens last one hour. Refresh with `grant_type=refresh_token` at the same
endpoint; refresh tokens last 30 days and a fresh one is issued on every
renewal, so a client calling at least once a month keeps working indefinitely.

Two things to know about refreshing. A refresh token can only be used once: if
your client refreshes but fails to persist the new token, replaying the old one
invalidates the whole family and the account holder has to authorize again.
And a refresh cannot widen a grant, so adding a scope means running the
authorization flow a second time.

## Calling the API

The API is tRPC, so paths are dotted procedure names under `/trpc` and responses
are wrapped in an envelope. Queries take input as a JSON query parameter,
mutations as a JSON body.

```bash
# Query
curl -G 'https://api.spliit.cloud/trpc/groups.list' \
  -H "Authorization: Bearer $TOKEN" \
  --data-urlencode 'input={"json":{}}'

# Mutation
curl -X POST 'https://api.spliit.cloud/trpc/groups.expenses.create' \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"json":{"groupId":"...","requestId":"<uuid>","expense":{ ... }}}'
```

A call missing the right scope returns `403` with
`Missing required scope: <scope>`.

Send a `User-Agent` identifying your client. Spliit Cloud sits behind
Cloudflare, which answers default HTTP-library agents with a challenge page
rather than reaching the API.

## Reviewing and revoking

Account settings list every app that has been authorized, with the scopes it
holds. Disconnecting revokes the client's refresh tokens, so it cannot renew.
An access token already issued keeps working until it expires, which is at most
an hour.

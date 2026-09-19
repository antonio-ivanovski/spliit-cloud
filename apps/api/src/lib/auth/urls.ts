import { env } from '../env'

/**
 * Strip terminal trailing slashes from a base URL. The schema already
 * normalizes `env` values, but tests mock `env` directly and operators can
 * mutate it, so getters strip defensively: every concatenation site appends its
 * own leading slash (`${base}/groups/…`), and a stored slash would otherwise
 * rebuild the `//groups/…` invite-link bug (issue #120). Silent here —
 * `parseEnv` already warns about the non-canonical value.
 */
function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

export function getApiBaseUrl(): string {
  if (env.BETTER_AUTH_URL) return normalizeBaseUrl(env.BETTER_AUTH_URL)
  // In local dev the API runs on 3001 and the web on 3000. Use the configured
  // port to derive a sensible base URL when no explicit override is set.
  return `http://localhost:${env.PORT}`
}

export function getWebBaseUrl(): string {
  const firstWebOrigin = env.WEB_ORIGINS.split(',')
    .map((o) => normalizeBaseUrl(o))
    .find(Boolean)
  return firstWebOrigin ?? 'http://localhost:3000'
}

/**
 * Audiences an access token may legitimately carry.
 *
 * The API is its own resource server, so tokens minted for it use the API base
 * URL. The MCP audience is preserved whenever MCP_PUBLIC_URL is configured:
 * tokens issued to assistant clients before the provider was ungated carry
 * `${MCP_PUBLIC_URL}/mcp` and must keep verifying. Both the provider and the
 * request-side resolver read this list, so they cannot drift apart.
 *
 * This list only says which audiences can be _authenticated_. It does not grant
 * an MCP-audience token access to the direct API surface: `apiProcedure` and
 * `scopedGroupReadProcedure` additionally require the API base URL in the
 * token's own `aud` claim (see `OAuthResolvedAuth.audiences`).
 */
export function oauthAudiences(): string[] {
  const audiences = [getApiBaseUrl()]
  if (env.MCP_PUBLIC_URL)
    audiences.push(`${normalizeBaseUrl(env.MCP_PUBLIC_URL)}/mcp`)
  return audiences
}

/**
 * The audience identifying the MCP resource (`<MCP_PUBLIC_URL>/mcp`).
 *
 * The assistant surface is the MCP resource's backend: it only serves tokens
 * minted for the MCP resource, never tokens minted for the direct API — even
 * when they carry the same scope. `MCP_PUBLIC_URL` is required whenever
 * `ENABLE_MCP` is set (see env validation), so callers behind the MCP gate can
 * rely on this being defined.
 */
export function getMcpAudience(): string | null {
  return env.MCP_PUBLIC_URL
    ? `${normalizeBaseUrl(env.MCP_PUBLIC_URL)}/mcp`
    : null
}

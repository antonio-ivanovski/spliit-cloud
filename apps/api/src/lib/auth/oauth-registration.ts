/**
 * Better Auth 1.7 defaults omitted `application_type` to `web`, then rejects
 * http loopback redirect URIs (RFC 8252). Public MCP clients (Inspector, local
 * mcp-use) register with `http://localhost` and no application_type. Infer
 * `native` so those DCR payloads keep working.
 */
export function applyNativeApplicationTypeForLoopbackRegistration(body: {
  application_type?: unknown
  redirect_uris?: unknown
}): void {
  if (body.application_type != null) return
  const redirectUris = Array.isArray(body.redirect_uris)
    ? body.redirect_uris
    : []
  if (
    redirectUris.length > 0 &&
    redirectUris.every(
      (uri) => typeof uri === 'string' && isLoopbackHttpRedirectUri(uri),
    )
  ) {
    body.application_type = 'native'
  }
}

function isLoopbackHttpRedirectUri(uri: string): boolean {
  let url: URL
  try {
    url = new URL(uri)
  } catch {
    return false
  }
  if (url.protocol !== 'http:') return false
  const host = url.hostname.toLowerCase()
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '[::1]'
  )
}

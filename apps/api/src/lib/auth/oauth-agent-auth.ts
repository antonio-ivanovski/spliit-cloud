import type { OAuthProviderExtension } from '@better-auth/oauth-provider'

import { getApiBaseUrl, getWebBaseUrl } from './urls'

/**
 * Machine-readable half of `/auth.md`: the `agent_auth` block for RFC 8414
 * authorization-server metadata.
 *
 * Spliit's registration method is standard OAuth 2.1 — dynamic client
 * registration (RFC 7591) followed by the account holder signing in and
 * approving scopes in the browser. That is the user-claimed `service_auth`
 * shape; there is no ID-JAG (`identity_assertion`) trust path and no anonymous
 * credential issuance, so those flows are deliberately absent rather than
 * advertised and unimplemented. URLs derive from env so self-hosted instances
 * describe themselves, not spliit.cloud.
 */
export function getAgentAuthMetadata() {
  return {
    skill: new URL('/auth.md', getWebBaseUrl()).toString(),
    register_uri: new URL('/auth/oauth2/register', getApiBaseUrl()).toString(),
    revocation_uri: new URL('/auth/oauth2/revoke', getApiBaseUrl()).toString(),
    identity_types_supported: ['service_auth'],
    service_auth: {
      credential_types_supported: ['access_token'],
    },
  }
}

/**
 * Adds `agent_auth` to the discovery document. The provider serves the OIDC
 * metadata body from both the authorization-server and openid-configuration
 * routes (its AS handler switches to the OIDC document whenever `openid` is in
 * the advertised scopes), so the block is contributed for every type rather
 * than filtering on one.
 */
export const agentAuthMetadataExtension: OAuthProviderExtension = {
  metadata: () => ({ agent_auth: getAgentAuthMetadata() }),
}

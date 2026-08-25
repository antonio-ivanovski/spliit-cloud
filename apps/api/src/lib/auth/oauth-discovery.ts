import { ALL_SCOPES } from './scopes'
import { getApiBaseUrl } from './urls'

export const OAUTH_PROTECTED_RESOURCE_PATH =
  '/.well-known/oauth-protected-resource'

/** RFC 9728 metadata that lets an unknown OAuth client discover Spliit. */
export function getOAuthProtectedResourceMetadata() {
  const resource = getApiBaseUrl()
  return {
    resource,
    authorization_servers: [new URL('/auth', resource).toString()],
    scopes_supported: [...ALL_SCOPES],
    bearer_methods_supported: ['header'],
    resource_name: 'Spliit API',
    resource_documentation: new URL('/docs', resource).toString(),
  }
}

/** RFC 9728 challenge used by OAuth-enabled API procedures. */
export function getOAuthProtectedResourceChallenge(): string {
  const metadataUrl = new URL(OAUTH_PROTECTED_RESOURCE_PATH, getApiBaseUrl())
  return `Bearer resource_metadata="${metadataUrl.toString()}"`
}

import { describe, expect, it } from 'vitest'

import {
  agentAuthMetadataExtension,
  getAgentAuthMetadata,
} from './oauth-agent-auth'
import { getApiBaseUrl, getWebBaseUrl } from './urls'

describe('getAgentAuthMetadata', () => {
  it('describes dynamic client registration and the user-consent flow', () => {
    expect(getAgentAuthMetadata()).toEqual({
      skill: new URL('/auth.md', getWebBaseUrl()).toString(),
      register_uri: new URL(
        '/auth/oauth2/register',
        getApiBaseUrl(),
      ).toString(),
      revocation_uri: new URL(
        '/auth/oauth2/revoke',
        getApiBaseUrl(),
      ).toString(),
      identity_types_supported: ['service_auth'],
      service_auth: { credential_types_supported: ['access_token'] },
    })
  })

  it('never advertises identity_assertion or anonymous registration', () => {
    const metadata = getAgentAuthMetadata()

    expect(metadata.identity_types_supported).not.toContain(
      'identity_assertion',
    )
    expect(metadata.identity_types_supported).not.toContain('anonymous')
    expect(metadata).not.toHaveProperty('identity_assertion')
    expect(metadata).not.toHaveProperty('anonymous')
  })
})

describe('agentAuthMetadataExtension', () => {
  it('contributes agent_auth to discovery metadata', () => {
    const contribute = agentAuthMetadataExtension.metadata!
    const input = {} as Parameters<typeof contribute>[0]

    expect(contribute(input)).toEqual({
      agent_auth: getAgentAuthMetadata(),
    })
  })
})

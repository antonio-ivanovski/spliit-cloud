import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../env', () => ({
  env: {
    get BETTER_AUTH_URL() {
      return process.env.TEST_BETTER_AUTH_URL
    },
    get MCP_PUBLIC_URL() {
      return process.env.TEST_MCP_PUBLIC_URL
    },
    get PORT() {
      return 3001
    },
    get WEB_ORIGINS() {
      return process.env.TEST_WEB_ORIGINS ?? 'http://localhost:3000'
    },
  },
}))

const {
  getApiBaseUrl,
  getMcpAudience,
  getPasskeyRpID,
  getWebBaseUrl,
  oauthAudiences,
} = await import('./urls')

afterEach(() => {
  delete process.env.TEST_BETTER_AUTH_URL
  delete process.env.TEST_MCP_PUBLIC_URL
  delete process.env.TEST_WEB_ORIGINS
})

describe('oauthAudiences', () => {
  it('always accepts tokens minted for the API itself', () => {
    process.env.TEST_BETTER_AUTH_URL = 'https://api.example.test'

    expect(oauthAudiences()).toEqual(['https://api.example.test'])
  })

  it('keeps accepting the MCP audience while MCP_PUBLIC_URL is set', () => {
    // Tokens issued before the API became its own resource server carry
    // `${MCP_PUBLIC_URL}/mcp`; dropping that audience would sign every live
    // assistant client out at deploy time.
    process.env.TEST_BETTER_AUTH_URL = 'https://api.example.test'
    process.env.TEST_MCP_PUBLIC_URL = 'https://mcp.example.test'

    expect(oauthAudiences()).toEqual([
      'https://api.example.test',
      'https://mcp.example.test/mcp',
    ])
  })

  it('drops the MCP audience once the deployment stops configuring it', () => {
    process.env.TEST_BETTER_AUTH_URL = 'https://api.example.test'

    expect(oauthAudiences()).not.toContain('https://mcp.example.test/mcp')
  })
})

describe('trailing-slash tolerance (issue #120)', () => {
  it('strips a trailing slash from the web base URL', () => {
    process.env.TEST_WEB_ORIGINS = 'https://spliit.example.test/'

    expect(getWebBaseUrl()).toBe('https://spliit.example.test')
    expect(`${getWebBaseUrl()}/groups/g?invite=t`).toBe(
      'https://spliit.example.test/groups/g?invite=t',
    )
  })

  it('strips slashes per-entry in a comma-separated WEB_ORIGINS list', () => {
    process.env.TEST_WEB_ORIGINS =
      'https://a.example.test/, https://b.example.test/// '

    expect(getWebBaseUrl()).toBe('https://a.example.test')
  })

  it('strips a trailing slash from the API base URL', () => {
    process.env.TEST_BETTER_AUTH_URL = 'https://api.example.test/'

    expect(getApiBaseUrl()).toBe('https://api.example.test')
  })

  it('never emits double slashes for API and MCP audiences', () => {
    process.env.TEST_BETTER_AUTH_URL = 'https://api.example.test/'
    process.env.TEST_MCP_PUBLIC_URL = 'https://mcp.example.test/'

    expect(oauthAudiences()).toEqual([
      'https://api.example.test',
      'https://mcp.example.test/mcp',
    ])
    expect(getMcpAudience()).toBe('https://mcp.example.test/mcp')
  })
})

describe('getPasskeyRpID', () => {
  it('uses localhost for local development', () => {
    process.env.TEST_WEB_ORIGINS = 'http://localhost:3000'

    expect(getPasskeyRpID()).toBe('localhost')
  })

  it('uses the web hostname, not the API hostname', () => {
    // Split-origin deployments call navigator.credentials from the web
    // origin; an API-derived rpID would fail WebAuthn verification.
    process.env.TEST_WEB_ORIGINS = 'https://app.example.test'
    process.env.TEST_BETTER_AUTH_URL = 'https://api.example.test'

    expect(getPasskeyRpID()).toBe('app.example.test')
  })

  it('strips ports and uses the first web origin', () => {
    process.env.TEST_WEB_ORIGINS =
      'https://app.example.test:8443, https://b.example.test'

    expect(getPasskeyRpID()).toBe('app.example.test')
  })
})

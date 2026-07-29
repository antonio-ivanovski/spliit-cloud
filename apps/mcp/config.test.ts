import { describe, expect, it } from 'vitest'

import { parseMcpEnv } from './config'

describe('parseMcpEnv', () => {
  it('requires every service URL', () => {
    expect(() => parseMcpEnv({})).toThrow()
  })

  it('normalizes configured URLs and defaults the port', () => {
    expect(
      parseMcpEnv({
        MCP_API_URL: 'https://api.spliit.example/',
        MCP_PUBLIC_URL: 'https://mcp.spliit.example/',
        MCP_WEB_URL: 'https://spliit.example/',
      }),
    ).toEqual({
      nodeEnv: undefined,
      port: 3002,
      apiUrl: 'https://api.spliit.example',
      mcpUrl: 'https://mcp.spliit.example',
      webUrl: 'https://spliit.example',
    })
  })

  it('rejects malformed URLs and ports', () => {
    expect(() =>
      parseMcpEnv({
        MCP_API_URL: 'api',
        MCP_PUBLIC_URL: 'mcp',
        MCP_WEB_URL: 'web',
        PORT: 'zero',
      }),
    ).toThrow()
  })

  it('requires MCP_PUBLIC_URL to be a service origin', () => {
    expect(() =>
      parseMcpEnv({
        MCP_API_URL: 'https://api.spliit.example',
        MCP_PUBLIC_URL: 'https://mcp.spliit.example/mcp',
        MCP_WEB_URL: 'https://spliit.example',
      }),
    ).toThrow('MCP_PUBLIC_URL must be an origin')
  })
})

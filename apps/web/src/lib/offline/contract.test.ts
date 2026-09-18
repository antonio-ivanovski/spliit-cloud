import { describe, expect, it } from 'vitest'

import { buildNamespace, normalizeApiOrigin, parseNamespace } from './contract'

describe('offline namespace', () => {
  it('normalizes origin case, trailing slash, default ports, and /trpc', () => {
    expect(normalizeApiOrigin('https://API.Example.com/')).toBe(
      'https://api.example.com',
    )
    expect(normalizeApiOrigin('https://api.example.com:443/trpc')).toBe(
      'https://api.example.com',
    )
    expect(normalizeApiOrigin('http://localhost:3001/trpc')).toBe(
      'http://localhost:3001',
    )
    expect(normalizeApiOrigin('http://localhost:80/')).toBe('http://localhost')
    expect(normalizeApiOrigin('https://example.com:443/api')).toBe(
      'https://example.com/api',
    )
  })

  it('keeps non-default ports and base paths, lowercases host only', () => {
    expect(normalizeApiOrigin('https://Example.COM:8443/Api')).toBe(
      'https://example.com:8443/Api',
    )
    expect(normalizeApiOrigin('http://localhost:3001')).toBe(
      'http://localhost:3001',
    )
  })

  it('builds isolated namespaces per deployment and account', () => {
    const a1 = buildNamespace('http://localhost:3001', 'account-a')
    const a2 = buildNamespace('http://localhost:3001', 'account-b')
    const b1 = buildNamespace('https://api.example.com', 'account-a')
    expect(a1).not.toBe(a2)
    expect(a1).not.toBe(b1)
    // API identity prevents mixing deployments served from one web origin:
    // same account on different API origins gets different namespaces.
    expect(parseNamespace(a1)).toEqual({
      apiOrigin: 'http://localhost:3001',
      accountId: 'account-a',
    })
    expect(parseNamespace('not-json')).toBeNull()
  })
})

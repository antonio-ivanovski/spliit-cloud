import { afterEach, describe, expect, it, vi } from 'vitest'

import { getStatusPageUrl } from '@/lib/status-page'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('getStatusPageUrl', () => {
  it('returns null when unconfigured (self-hosters without a status page)', () => {
    vi.stubEnv('VITE_STATUS_PAGE_URL', '')
    expect(getStatusPageUrl()).toBeNull()
  })

  it('returns the configured URL', () => {
    vi.stubEnv('VITE_STATUS_PAGE_URL', 'https://status.spliit.cloud/')
    expect(getStatusPageUrl()).toBe('https://status.spliit.cloud/')
  })

  it('rejects blank, invalid, and non-http(s) values', () => {
    vi.stubEnv('VITE_STATUS_PAGE_URL', '   ')
    expect(getStatusPageUrl()).toBeNull()
    vi.stubEnv('VITE_STATUS_PAGE_URL', 'not a url')
    expect(getStatusPageUrl()).toBeNull()
    vi.stubEnv('VITE_STATUS_PAGE_URL', 'ftp://status.example.com')
    expect(getStatusPageUrl()).toBeNull()
  })
})

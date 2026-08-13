import { describe, expect, it } from 'vitest'

import './test/mocks'
import { requestWithTrustedProxyHeaders } from './app'

describe('proxy header trust', () => {
  it('removes client-supplied IP headers when proxy trust is disabled', () => {
    const request = new Request('https://api.example.test/auth/get-session', {
      headers: {
        'cf-connecting-ip': '203.0.113.1',
        'x-forwarded-for': '203.0.113.2',
        'x-real-ip': '203.0.113.3',
        'x-request-id': 'keep-me',
      },
    })

    const sanitized = requestWithTrustedProxyHeaders(request)

    expect(sanitized.headers.get('cf-connecting-ip')).toBeNull()
    expect(sanitized.headers.get('x-forwarded-for')).toBeNull()
    expect(sanitized.headers.get('x-real-ip')).toBeNull()
    expect(sanitized.headers.get('x-request-id')).toBe('keep-me')
  })
})

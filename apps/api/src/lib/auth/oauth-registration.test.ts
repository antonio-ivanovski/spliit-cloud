import { describe, expect, it } from 'vitest'

import { applyNativeApplicationTypeForLoopbackRegistration } from './oauth-registration'

describe('applyNativeApplicationTypeForLoopbackRegistration', () => {
  it('defaults loopback HTTP clients to native', () => {
    const body: { application_type?: string; redirect_uris: string[] } = {
      redirect_uris: ['http://localhost:3002/oauth/callback'],
    }
    applyNativeApplicationTypeForLoopbackRegistration(body)
    expect(body.application_type).toBe('native')
  })

  it('accepts 127.0.0.1 and IPv6 loopback', () => {
    const ipv4: { application_type?: string; redirect_uris: string[] } = {
      redirect_uris: ['http://127.0.0.1:6274/callback'],
    }
    applyNativeApplicationTypeForLoopbackRegistration(ipv4)
    expect(ipv4.application_type).toBe('native')

    const ipv6: { application_type?: string; redirect_uris: string[] } = {
      redirect_uris: ['http://[::1]:6274/callback'],
    }
    applyNativeApplicationTypeForLoopbackRegistration(ipv6)
    expect(ipv6.application_type).toBe('native')
  })

  it('does not override an explicit application_type', () => {
    const body: { application_type?: string; redirect_uris: string[] } = {
      application_type: 'web',
      redirect_uris: ['http://localhost:3002/oauth/callback'],
    }
    applyNativeApplicationTypeForLoopbackRegistration(body)
    expect(body.application_type).toBe('web')
  })

  it('leaves https and non-loopback clients unchanged', () => {
    const httpsBody: { application_type?: string; redirect_uris: string[] } = {
      redirect_uris: ['https://chatgpt.com/connector/oauth/callback'],
    }
    applyNativeApplicationTypeForLoopbackRegistration(httpsBody)
    expect(httpsBody.application_type).toBeUndefined()

    const mixed: { application_type?: string; redirect_uris: string[] } = {
      redirect_uris: [
        'http://localhost:3002/oauth/callback',
        'https://app.example/callback',
      ],
    }
    applyNativeApplicationTypeForLoopbackRegistration(mixed)
    expect(mixed.application_type).toBeUndefined()
  })
})

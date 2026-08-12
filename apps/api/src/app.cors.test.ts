import { describe, expect, it } from 'vitest'

import './test/mocks'
import { app } from './app'
import { SIGNUP_INVITE_HEADER } from './lib/auth/signup-gate'

describe('API CORS', () => {
  it('allows the signup invite header on auth preflight', async () => {
    const response = await app.request('/auth/sign-up/email', {
      method: 'OPTIONS',
      headers: {
        origin: 'http://localhost:3000',
        'access-control-request-method': 'POST',
        'access-control-request-headers': SIGNUP_INVITE_HEADER,
      },
    })

    expect(response.status).toBe(204)
    expect(
      response.headers.get('access-control-allow-headers')?.toLowerCase(),
    ).toContain(SIGNUP_INVITE_HEADER)
  })
})

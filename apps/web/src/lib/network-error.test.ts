import { describe, expect, it } from 'vitest'

import { isNetworkError } from '@/lib/network-error'

describe('isNetworkError', () => {
  it('matches browser fetch failures', () => {
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true)
    expect(isNetworkError(new TypeError('Load failed'))).toBe(true)
    expect(
      isNetworkError(
        new Error('NetworkError when attempting to fetch resource'),
      ),
    ).toBe(true)
    expect(isNetworkError(new Error('ERR_INTERNET_DISCONNECTED'))).toBe(true)
  })

  it('matches a wrapped fetch failure', () => {
    expect(
      isNetworkError(
        new Error('session request failed', {
          cause: new TypeError('Failed to fetch'),
        }),
      ),
    ).toBe(true)
  })

  it('does not match HTTP or app errors', () => {
    expect(isNetworkError(new Error('UNAUTHORIZED'))).toBe(false)
    expect(
      isNetworkError(new TypeError('Cannot read properties of null')),
    ).toBe(false)
    expect(isNetworkError({ status: 401, message: 'Unauthorized' })).toBe(false)
    expect(isNetworkError(null)).toBe(false)
  })
})

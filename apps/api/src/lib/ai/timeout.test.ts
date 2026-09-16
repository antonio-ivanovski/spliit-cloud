import { describe, expect, it } from 'vitest'

import { isTimeoutError, timeoutSecondsToMs } from './timeout'

describe('isTimeoutError', () => {
  it('matches AI SDK timeout aborts', () => {
    expect(
      isTimeoutError(
        new DOMException('total timeout of 120000ms exceeded', 'TimeoutError'),
      ),
    ).toBe(true)
  })

  it('matches aborts and timeout messages without a structured code', () => {
    expect(isTimeoutError({ name: 'AbortError' })).toBe(true)
    expect(isTimeoutError(new Error('Request timed out'))).toBe(true)
    expect(isTimeoutError({ name: 'TimeoutError', message: 'upsteam' })).toBe(
      true,
    )
  })

  it('follows nested causes', () => {
    expect(
      isTimeoutError({
        message: 'fetch failed',
        cause: { name: 'TimeoutError' },
      }),
    ).toBe(true)
  })

  it('rejects unrelated failures', () => {
    expect(isTimeoutError(new Error('AI service unavailable'))).toBe(false)
    expect(isTimeoutError({ code: 'TIMEOUT' })).toBe(false)
    expect(isTimeoutError(null)).toBe(false)
    expect(isTimeoutError(undefined)).toBe(false)
    expect(isTimeoutError('timeout')).toBe(false)
  })
})

describe('timeoutSecondsToMs', () => {
  it('converts seconds env values to generateText milliseconds', () => {
    expect(timeoutSecondsToMs(120)).toBe(120_000)
    expect(timeoutSecondsToMs(30)).toBe(30_000)
  })
})

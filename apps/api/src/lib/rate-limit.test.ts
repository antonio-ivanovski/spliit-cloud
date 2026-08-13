import { describe, expect, it } from 'vitest'

import { FixedWindowLimiter, resolveClientIp } from './rate-limit'

describe('FixedWindowLimiter', () => {
  it('allows requests up to the limit then rejects with retry-after', () => {
    const limiter = new FixedWindowLimiter({ limit: 3, windowMs: 60_000 })
    const now = 1_000_000

    expect(limiter.hit('ip', now)).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    })
    expect(limiter.hit('ip', now)).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    })
    expect(limiter.hit('ip', now)).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    })

    const blocked = limiter.hit('ip', now)
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterSeconds).toBe(60)
  })

  it('tracks keys independently', () => {
    const limiter = new FixedWindowLimiter({ limit: 1, windowMs: 60_000 })
    const now = 1_000_000

    expect(limiter.hit('a', now).allowed).toBe(true)
    expect(limiter.hit('b', now).allowed).toBe(true)
    expect(limiter.hit('a', now).allowed).toBe(false)
    expect(limiter.hit('b', now).allowed).toBe(false)
  })

  it('supports weighted consumption', () => {
    const limiter = new FixedWindowLimiter({ limit: 5, windowMs: 60_000 })
    const now = 1_000_000

    expect(limiter.hit('sender', now, 4).allowed).toBe(true)
    expect(limiter.hit('sender', now).allowed).toBe(true)
    expect(limiter.hit('sender', now).allowed).toBe(false)
  })

  it('rejects invalid consumption costs', () => {
    const limiter = new FixedWindowLimiter({ limit: 5, windowMs: 60_000 })

    expect(() => limiter.hit('sender', Date.now(), 0)).toThrow(RangeError)
  })

  it('resets the window once it expires', () => {
    const limiter = new FixedWindowLimiter({ limit: 1, windowMs: 60_000 })
    const now = 1_000_000

    expect(limiter.hit('ip', now).allowed).toBe(true)
    expect(limiter.hit('ip', now + 1000).allowed).toBe(false)
    expect(limiter.hit('ip', now + 60_001).allowed).toBe(true)
  })

  it('bounds memory by evicting expired then soonest-resetting buckets', () => {
    const limiter = new FixedWindowLimiter({
      limit: 5,
      windowMs: 60_000,
      maxKeys: 3,
    })
    const now = 1_000_000

    limiter.hit('a', now)
    limiter.hit('b', now + 10)
    limiter.hit('c', now + 20)
    expect(limiter.size).toBe(3)

    // A fourth distinct key forces eviction down to maxKeys.
    limiter.hit('d', now + 30)
    expect(limiter.size).toBeLessThanOrEqual(3)
    // The newest key is retained.
    expect(limiter.hit('d', now + 31).allowed).toBe(true)
  })
})

describe('resolveClientIp', () => {
  it('collapses all callers into one bucket when no proxy is trusted', () => {
    const headers = new Headers({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' })
    expect(resolveClientIp(headers, { trustProxy: false })).toBe('direct')
    expect(resolveClientIp(new Headers(), { trustProxy: false })).toBe('direct')
  })

  it('prefers Cloudflare client IP over generic proxy headers', () => {
    const headers = new Headers({
      'cf-connecting-ip': '203.0.113.7',
      'x-forwarded-for': 'spoofed-by-client, 10.0.0.1',
      'x-real-ip': '10.0.0.2',
    })
    expect(resolveClientIp(headers, { trustProxy: true })).toBe('203.0.113.7')
  })

  it('falls back to x-real-ip and then the original forwarded client', () => {
    expect(
      resolveClientIp(new Headers({ 'x-real-ip': '9.9.9.9' }), {
        trustProxy: true,
      }),
    ).toBe('9.9.9.9')
    expect(
      resolveClientIp(
        new Headers({ 'x-forwarded-for': '192.0.2.1, 10.0.0.1' }),
        { trustProxy: true },
      ),
    ).toBe('192.0.2.1')
  })

  it('rejects malformed proxy headers', () => {
    expect(
      resolveClientIp(
        new Headers({
          'cf-connecting-ip': 'not-an-ip',
          'x-real-ip': 'also-invalid',
          'x-forwarded-for': 'spoofed-by-client',
        }),
        { trustProxy: true },
      ),
    ).toBe('unknown')
    expect(resolveClientIp(new Headers(), { trustProxy: true })).toBe('unknown')
  })
})

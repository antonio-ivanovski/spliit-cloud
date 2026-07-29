type Bucket = { count: number; resetAt: number }

export type RateLimitDecision = {
  allowed: boolean
  /** Seconds until the window resets; 0 when the request is allowed. */
  retryAfterSeconds: number
}

/**
 * Process-local fixed-window rate limiter. Counters are intentionally kept in
 * memory: they are a best-effort abuse brake for a single replica, not a
 * globally consistent quota. The map is bounded — expired buckets are evicted
 * first, then the soonest-resetting ones — so it cannot grow without limit as
 * new client IPs or account IDs appear.
 */
export class FixedWindowLimiter {
  private readonly buckets = new Map<string, Bucket>()

  constructor(
    private readonly options: {
      limit: number
      windowMs: number
      maxKeys?: number
    },
  ) {}

  hit(key: string, now: number = Date.now()): RateLimitDecision {
    this.evict(now)
    const existing = this.buckets.get(key)
    const bucket: Bucket =
      !existing || existing.resetAt <= now
        ? { count: 0, resetAt: now + this.options.windowMs }
        : existing
    bucket.count += 1
    this.buckets.set(key, bucket)
    if (bucket.count > this.options.limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((bucket.resetAt - now) / 1000),
        ),
      }
    }
    return { allowed: true, retryAfterSeconds: 0 }
  }

  get size(): number {
    return this.buckets.size
  }

  private evict(now: number): void {
    const maxKeys = this.options.maxKeys ?? 10_000
    if (this.buckets.size < maxKeys) return
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key)
    }
    if (this.buckets.size < maxKeys) return
    const overflow = this.buckets.size - maxKeys + 1
    const soonest = [...this.buckets.entries()]
      .sort((a, b) => a[1].resetAt - b[1].resetAt)
      .slice(0, overflow)
    for (const [key] of soonest) this.buckets.delete(key)
  }
}

/**
 * Resolve a rate-limit identity from request headers. Forwarded headers are
 * only honored when the API is known to sit behind a trusted proxy; otherwise
 * they are client-controlled and spoofable, so every caller shares a single
 * conservative bucket. When trusted, the right-most `x-forwarded-for` hop is
 * used because the closest proxy appends (or overwrites with) the real client
 * address, while earlier entries can be forged by the client.
 */
export function resolveClientIp(
  headers: Headers,
  options: { trustProxy: boolean },
): string {
  if (!options.trustProxy) return 'direct'
  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) {
    const hops = forwarded
      .split(',')
      .map((hop) => hop.trim())
      .filter(Boolean)
    const ip = hops[hops.length - 1]
    if (ip) return ip
  }
  return headers.get('x-real-ip') ?? 'unknown'
}

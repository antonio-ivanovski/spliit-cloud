import type { NormalizedSource } from '@spliit/domain/import'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearSourceCache,
  getCachedSource,
  setCachedSource,
  sourceCacheSize,
} from '../import-source-cache'

const MAX_ENTRIES = 256

function makeSource(overrides?: Partial<NormalizedSource>): NormalizedSource {
  return {
    provider: 'SPLIIT',
    sourceGroupId: 'test-group',
    sourceUrl: null,
    name: 'Test Source',
    currency: 'USD',
    currencyCode: 'USD',
    participants: [],
    expenses: [],
    ...overrides,
  }
}

describe('import-source-cache', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    clearSourceCache()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('setCachedSource + getCachedSource returns the stored source', () => {
    const source = makeSource({ sourceGroupId: 'g1', name: 'Group 1' })
    setCachedSource('g1', source)
    expect(getCachedSource('g1')).toEqual(source)
  })

  it('getCachedSource returns null for a missing key', () => {
    expect(getCachedSource('nonexistent')).toBeNull()
  })

  it('getCachedSource returns null for an expired entry', () => {
    setCachedSource('g1', makeSource({ sourceGroupId: 'g1' }))
    // Default TTL is 5 minutes; advance well past it
    vi.advanceTimersByTime(5 * 60 * 1000 + 1)
    expect(getCachedSource('g1')).toBeNull()
  })

  it('sourceCacheSize returns 0 when empty', () => {
    expect(sourceCacheSize()).toBe(0)
  })

  it('sourceCacheSize returns > 0 with entries', () => {
    setCachedSource('g1', makeSource({ sourceGroupId: 'g1' }))
    expect(sourceCacheSize()).toBe(1)
  })

  it('clearSourceCache empties the store', () => {
    setCachedSource('g1', makeSource({ sourceGroupId: 'g1' }))
    setCachedSource('g2', makeSource({ sourceGroupId: 'g2' }))
    expect(sourceCacheSize()).toBe(2)

    clearSourceCache()
    expect(sourceCacheSize()).toBe(0)
    expect(getCachedSource('g1')).toBeNull()
    expect(getCachedSource('g2')).toBeNull()
  })

  it('enforces MAX_ENTRIES capacity', () => {
    // Insert MAX_ENTRIES + 1 entries with unique keys
    for (let i = 0; i < MAX_ENTRIES + 1; i++) {
      setCachedSource(
        `key-${i}`,
        makeSource({ sourceGroupId: `key-${i}`, name: `Source ${i}` }),
      )
    }
    // Cache must not exceed MAX_ENTRIES
    expect(sourceCacheSize()).toBeLessThanOrEqual(MAX_ENTRIES)
  })

  it('multiple entries with different keys work', () => {
    const sources = [
      makeSource({ sourceGroupId: 'a', name: 'Alpha' }),
      makeSource({ sourceGroupId: 'b', name: 'Beta' }),
      makeSource({ sourceGroupId: 'c', name: 'Gamma' }),
    ]
    setCachedSource('a', sources[0])
    setCachedSource('b', sources[1])
    setCachedSource('c', sources[2])

    expect(getCachedSource('a')).toEqual(sources[0])
    expect(getCachedSource('b')).toEqual(sources[1])
    expect(getCachedSource('c')).toEqual(sources[2])
    expect(sourceCacheSize()).toBe(3)
  })

  it('overwriting an existing key updates the entry', () => {
    const original = makeSource({ sourceGroupId: 'g1', name: 'Original' })
    const updated = makeSource({ sourceGroupId: 'g1', name: 'Updated' })

    setCachedSource('g1', original)
    expect(getCachedSource('g1')).toEqual(original)

    setCachedSource('g1', updated)
    expect(getCachedSource('g1')).toEqual(updated)
    // Still only one entry
    expect(sourceCacheSize()).toBe(1)
  })

  it('TTL expiration edge case with 1ms TTL', () => {
    setCachedSource(
      'g1',
      makeSource({ sourceGroupId: 'g1' }),
      1, // 1 millisecond TTL
    )
    expect(getCachedSource('g1')).not.toBeNull()

    vi.advanceTimersByTime(2) // advance 2ms
    expect(getCachedSource('g1')).toBeNull()
  })

  it('evictExpired is called on read and cleans stale entries', () => {
    // Insert two entries, one with very short TTL
    setCachedSource(
      'short',
      makeSource({ sourceGroupId: 'short' }),
      10, // 10ms TTL
    )
    setCachedSource(
      'long',
      makeSource({ sourceGroupId: 'long' }),
      10_000, // 10s TTL
    )
    expect(sourceCacheSize()).toBe(2)

    // Advance past short's TTL but not long's
    vi.advanceTimersByTime(20)

    // Both sourceCacheSize and getCachedSource call evictExpired internally
    expect(sourceCacheSize()).toBe(1)
    expect(getCachedSource('short')).toBeNull()
    expect(getCachedSource('long')).toEqual(
      expect.objectContaining({ sourceGroupId: 'long' }),
    )
  })
})

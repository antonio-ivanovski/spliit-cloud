import { describe, expect, it, vi } from 'vitest'

import {
  fetchEmojiImage,
  fetchImageAsDataUri,
  firstGrapheme,
  resetEmojiCacheForTests,
} from './remote-images'

describe('firstGrapheme', () => {
  it('keeps ZWJ sequences whole', () => {
    expect(firstGrapheme('👨‍👩‍👧abc')).toBe('👨‍👩‍👧')
  })

  it('returns an empty string for empty input', () => {
    expect(firstGrapheme('')).toBe('')
  })
})

describe('fetchImageAsDataUri', () => {
  it('rejects non-http URLs without fetching', async () => {
    const fetchImpl = vi.fn()
    expect(
      await fetchImageAsDataUri('data:image/png;base64,xx', fetchImpl),
    ).toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects non-image content types', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }))
    expect(
      await fetchImageAsDataUri('https://example.com/x', fetchImpl),
    ).toBeNull()
  })

  it('inlines small raster images', async () => {
    const bytes = new Uint8Array([137, 80, 78, 71])
    const fetchImpl = vi.fn(
      async () =>
        new Response(bytes, {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        }),
    )
    const uri = await fetchImageAsDataUri(
      'https://example.com/a.png',
      fetchImpl,
    )
    expect(uri?.startsWith('data:image/png;base64,')).toBe(true)
  })
})

describe('fetchEmojiImage', () => {
  it('strips the FE0F selector to match Twemoji asset names', async () => {
    resetEmojiCacheForTests()
    const seen: string[] = []
    const fetchImpl = vi.fn(async (url: string) => {
      seen.push(url)
      return new Response('{}', { status: 404 })
    })
    // 🏖️ is U+1F3D6 U+FE0F; the asset is 1f3d6.png.
    await fetchEmojiImage('🏖️', fetchImpl)
    expect(seen).toHaveLength(1)
    expect(seen[0]).toContain('/1f3d6.png')
  })

  it('retries misses instead of caching them', async () => {
    resetEmojiCacheForTests()
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 404 }))
    await fetchEmojiImage('🍻', fetchImpl)
    await fetchEmojiImage('🍻', fetchImpl)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('caches successful lookups', async () => {
    resetEmojiCacheForTests()
    const bytes = new Uint8Array([137, 80, 78, 71])
    const fetchImpl = vi.fn(
      async () =>
        new Response(bytes, {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        }),
    )
    await fetchEmojiImage('🎉', fetchImpl)
    await fetchEmojiImage('🎉', fetchImpl)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

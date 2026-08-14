import { describe, expect, it } from 'vitest'

import {
  generateGroupViewKey,
  groupViewKeysMatch,
  redactViewerDisplayName,
} from './group-view'

describe('group view keys', () => {
  it('generates unique 256-bit URL-safe secrets', () => {
    const key = generateGroupViewKey()
    expect(key).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(Buffer.from(key, 'base64url').length).toBe(32)
    expect(generateGroupViewKey()).not.toBe(key)
  })

  it('compares keys in constant time and rejects length mismatches', () => {
    const key = generateGroupViewKey()
    expect(groupViewKeysMatch(key, key)).toBe(true)
    expect(groupViewKeysMatch(key, generateGroupViewKey())).toBe(false)
    expect(groupViewKeysMatch(key, key.slice(0, -1))).toBe(false)
  })

  it('redacts email-shaped display names', () => {
    expect(redactViewerDisplayName('Ada')).toBe('Ada')
    expect(redactViewerDisplayName('ada@example.com')).toBe('')
  })
})

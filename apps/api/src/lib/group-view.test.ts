import { describe, expect, it } from 'vitest'

import {
  fingerprintGroupViewKey,
  generateGroupViewKey,
  groupViewKeysMatch,
  isGroupViewKey,
  signGroupViewerSession,
  verifyGroupViewerSession,
} from './group-view'

describe('group view credentials', () => {
  it('generates a versioned 256-bit bearer key and fingerprints it deterministically', () => {
    const key = generateGroupViewKey()
    expect(isGroupViewKey(key)).toBe(true)
    expect(fingerprintGroupViewKey(key)).toHaveLength(64)
    expect(groupViewKeysMatch(key, key)).toBe(true)
    expect(groupViewKeysMatch(generateGroupViewKey(), key)).toBe(false)
    expect(fingerprintGroupViewKey(generateGroupViewKey())).not.toBe(
      fingerprintGroupViewKey(key),
    )
  })

  it('signs group-scoped viewer sessions and rejects tampering', async () => {
    const token = await signGroupViewerSession({
      kind: 'PUBLIC_VIEW',
      groupId: 'group-1',
      keyFingerprint: fingerprintGroupViewKey('current-key'),
    })
    await expect(verifyGroupViewerSession(token)).resolves.toEqual({
      kind: 'PUBLIC_VIEW',
      groupId: 'group-1',
      keyFingerprint: fingerprintGroupViewKey('current-key'),
    })
    const parts = token.split('.')
    const signature = parts[2]!
    const tampered = `${parts[0]}.${parts[1]}.${signature.startsWith('a') ? 'b' : 'a'}${signature.slice(1)}`
    await expect(verifyGroupViewerSession(tampered)).resolves.toBeNull()
  })
})

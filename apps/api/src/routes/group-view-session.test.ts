import { describe, expect, it } from 'vitest'

import '../test/mocks'
import { generateGroupViewKey } from '../lib/group-view'
import { prismaMock } from '../test/state'
import { exchangeGroupViewerSession } from './group-view-session'

function request(key: string) {
  return new Request('http://localhost/groups/group-1/view-session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'PUBLIC_VIEW', key }),
  })
}

describe('exchangeGroupViewerSession', () => {
  it('issues a no-store viewer cookie for the current group key', async () => {
    const key = generateGroupViewKey()
    prismaMock.group.findUnique.mockResolvedValue({
      groupType: 'GROUP',
      publicViewKey: key,
    } as never)

    const response = await exchangeGroupViewerSession(request(key), 'group-1')

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('set-cookie')).toContain('spliit.group_view=')
    expect(response.headers.get('set-cookie')).not.toContain(key)
  })

  it('rejects an old key after replacement without exposing why', async () => {
    const oldKey = generateGroupViewKey()
    prismaMock.group.findUnique.mockResolvedValue({
      groupType: 'GROUP',
      publicViewKey: generateGroupViewKey(),
    } as never)

    const response = await exchangeGroupViewerSession(
      request(oldKey),
      'group-1',
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: 'invalid_credential',
    })
  })
})

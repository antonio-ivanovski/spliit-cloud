import { unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'

import '../test/mocks'
import { authState, prismaMock } from '../test/state'
import { exportAccountBundle } from './export-account-bundle'

const selection = {
  sections: {
    GROUPS: false,
    FRIENDS: false,
    STARRED: false,
    ARCHIVED: false,
    HIDDEN: false,
  },
  groupOverrides: [],
  includeDocuments: false,
  includeAccountPreferences: true,
  includeGroupPreferences: false,
}

function makeRequest(body: unknown = selection): Request {
  return new Request('http://localhost/account/export/bundle', {
    method: 'POST',
    headers: new Headers({
      cookie: 'spliit.session=test-token',
      'content-type': 'application/json',
    }),
    body: JSON.stringify(body),
  })
}

function enableAccount() {
  authState.session = {
    user: { id: 'acct-1' },
    session: { id: 'sess-1' },
  }
  prismaMock.account.findUnique.mockResolvedValue({
    id: 'acct-1',
    name: 'Alice',
    email: 'alice@example.com',
    preference: null,
    notificationPreferences: [],
  } as never)
}

describe('exportAccountBundle route', () => {
  it('rejects unauthenticated callers before reading the selection', async () => {
    authState.session = null

    const response = await exportAccountBundle(makeRequest())

    expect(response.status).toBe(401)
    expect(prismaMock.account.findUnique).not.toHaveBeenCalled()
  })

  it('rejects malformed selections without opening a transaction', async () => {
    enableAccount()

    const response = await exportAccountBundle(
      makeRequest({ sections: {}, groupOverrides: [] }),
    )

    expect(response.status).toBe(400)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('streams an account-only bundle through the authenticated download route', async () => {
    enableAccount()
    prismaMock.groupMember.findMany.mockResolvedValue([])

    const response = await exportAccountBundle(makeRequest())

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/zip')
    expect(response.headers.get('content-disposition')).toMatch(
      /Spliit Cloud Account Export.*\.spliit\.zip/,
    )
    expect(prismaMock.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
    })

    const archive = unzipSync(new Uint8Array(await response.arrayBuffer()))
    const manifest = JSON.parse(
      new TextDecoder().decode(archive['manifest.json']),
    )
    expect(Object.keys(archive)).toEqual(['manifest.json'])
    expect(manifest).toMatchObject({
      format: 'spliit.cloud/export',
      version: 1,
      scope: { type: 'ACCOUNT', sourceId: 'acct-1' },
      groups: [],
      contents: {
        documents: false,
        accountPreferences: true,
        groupPreferences: false,
      },
    })
  })
})

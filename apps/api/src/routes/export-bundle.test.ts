import { unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'

import '../test/mocks'
import { authState, prismaMock } from '../test/state'
import { exportGroupBundle } from './export-bundle'

function makeRequest(): Request {
  return new Request('http://localhost/groups/grp-1/export/bundle', {
    headers: new Headers({ cookie: 'spliit.session=test-token' }),
  })
}

function makeGroup() {
  const now = new Date('2026-08-10T12:00:00.000Z')
  return {
    id: 'grp-1',
    name: 'Trip to Paris',
    information: 'Shared holiday costs',
    archived: false,
    groupType: 'GROUP',
    subgroupsEnabled: false,
    createdAt: now,
    ledgerId: 'ledger-1',
    ledger: {
      id: 'ledger-1',
      currency: '€',
      currencyCode: 'EUR',
      createdAt: now,
      participants: [],
      recurringExpenseSeries: [],
      documents: [],
      expenses: [],
    },
    subgroups: [],
    budgets: [],
  }
}

function enableMember() {
  authState.session = {
    user: { id: 'acct-1' },
    session: { id: 'sess-1' },
  }
  prismaMock.account.findUnique.mockResolvedValue({
    id: 'acct-1',
    email: 'alice@example.com',
  })
  prismaMock.groupMember.findUnique.mockResolvedValue({
    groupId: 'grp-1',
    accountId: 'acct-1',
    status: 'ACTIVE',
  } as never)
}

describe('exportGroupBundle route', () => {
  it('rejects unauthenticated callers before loading group data', async () => {
    authState.session = null

    const response = await exportGroupBundle(makeRequest(), 'grp-1')

    expect(response.status).toBe(401)
    expect(prismaMock.groupMember.findUnique).not.toHaveBeenCalled()
    expect(prismaMock.group.findUnique).not.toHaveBeenCalled()
  })

  it('rejects inactive members before loading group data', async () => {
    enableMember()
    prismaMock.groupMember.findUnique.mockResolvedValue({
      groupId: 'grp-1',
      accountId: 'acct-1',
      status: 'REMOVED',
    } as never)

    const response = await exportGroupBundle(makeRequest(), 'grp-1')

    expect(response.status).toBe(403)
    expect(prismaMock.group.findUnique).not.toHaveBeenCalled()
  })

  it('returns not found when the authorized group does not exist', async () => {
    enableMember()
    prismaMock.group.findUnique.mockResolvedValue(null)

    const response = await exportGroupBundle(makeRequest(), 'grp-1')

    expect(response.status).toBe(404)
  })

  it('adapts the reusable artifact to the existing download response', async () => {
    enableMember()
    prismaMock.group.findUnique.mockResolvedValue(makeGroup() as never)

    const response = await exportGroupBundle(makeRequest(), 'grp-1')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/zip')
    expect(response.headers.get('content-disposition')).toMatch(
      /\.spliit\.zip"$/,
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
      scope: { type: 'GROUP', sourceId: 'grp-1' },
      complete: true,
      group: { name: 'Trip to Paris' },
    })
  })
})

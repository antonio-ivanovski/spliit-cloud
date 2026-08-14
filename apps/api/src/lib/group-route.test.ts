import { beforeEach, describe, expect, it } from 'vitest'

import '../test/mocks'
import { prismaMock } from '../test/state'
import {
  generateUniqueGroupRouteId,
  isPendingUsableRouteInvitation,
  resolveGroupRouteId,
} from './group-route'
import { hashLinkToken } from './invitations'

describe('group route ids', () => {
  beforeEach(() => {
    prismaMock.group.findUnique.mockResolvedValue(null)
    prismaMock.groupInvitation.findUnique.mockResolvedValue(null)
  })

  it('resolves canonical ids before aliases', async () => {
    prismaMock.group.findUnique.mockResolvedValueOnce({
      id: 'canonical',
      ledger: { id: 'ledger-1' },
    } as never)

    await expect(resolveGroupRouteId('canonical')).resolves.toMatchObject({
      source: 'CANONICAL',
      group: { id: 'canonical' },
      invitation: null,
    })
    expect(prismaMock.group.findUnique).toHaveBeenCalledTimes(1)
  })

  it('resolves a public alias to its canonical group', async () => {
    prismaMock.group.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'canonical',
        publicViewId: 'a'.repeat(32),
        ledger: { id: 'ledger-1' },
      } as never)

    await expect(resolveGroupRouteId('a'.repeat(32))).resolves.toMatchObject({
      source: 'PUBLIC_LINK',
      group: { id: 'canonical' },
      invitation: null,
    })
  })

  it('resolves an invitation alias by its stored hash', async () => {
    const routeId = 'b'.repeat(32)
    prismaMock.groupInvitation.findUnique.mockResolvedValue({
      id: 'invitation-1',
      type: 'LINK',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 60_000),
      group: { id: 'canonical', ledger: { id: 'ledger-1' } },
    } as never)

    await expect(resolveGroupRouteId(routeId)).resolves.toMatchObject({
      source: 'INVITATION',
      group: { id: 'canonical' },
      invitation: { id: 'invitation-1' },
    })
    expect(prismaMock.groupInvitation.findUnique).toHaveBeenCalledWith({
      where: { tokenHash: await hashLinkToken(routeId) },
      include: { group: { include: { ledger: true } } },
    })
  })

  it('rejects expired or resolved invitation aliases as usable access', () => {
    expect(
      isPendingUsableRouteInvitation({
        status: 'PENDING',
        expiresAt: new Date(Date.now() - 1),
      }),
    ).toBe(false)
    expect(
      isPendingUsableRouteInvitation({ status: 'REVOKED', expiresAt: null }),
    ).toBe(false)
  })

  it('retries when a generated id collides with any existing route id', async () => {
    prismaMock.group.findFirst
      .mockResolvedValueOnce({ id: 'collision' } as never)
      .mockResolvedValueOnce(null)
    prismaMock.groupInvitation.findFirst.mockResolvedValue(null)

    await expect(generateUniqueGroupRouteId()).resolves.toMatch(
      /^[a-f0-9]{32}$/,
    )
    expect(prismaMock.group.findFirst).toHaveBeenCalledTimes(2)
  })
})

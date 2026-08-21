import { describe, expect, it } from 'vitest'

import '../../test/mocks'
import { prismaMock } from '../../test/state'
import {
  listAuthorizedClients,
  revokeAuthorizedClient,
} from './authorized-clients'

describe('listAuthorizedClients', () => {
  it('returns an empty list without querying tokens', async () => {
    prismaMock.oauthConsent.findMany.mockResolvedValue([] as never)

    const clients = await listAuthorizedClients('acct-1')

    expect(clients).toEqual([])
    expect(prismaMock.oauthRefreshToken.findMany).not.toHaveBeenCalled()
  })

  it('reports the furthest standing refresh expiry per client', async () => {
    const soon = new Date('2026-09-01T00:00:00Z')
    const later = new Date('2026-09-20T00:00:00Z')
    prismaMock.oauthConsent.findMany.mockResolvedValue([
      {
        id: 'consent-1',
        clientId: 'client-1',
        scopes: ['spliit:groups:read'],
        createdAt: new Date('2026-08-01T00:00:00Z'),
        oauthClient: { name: 'Agent', icon: null },
      },
    ] as never)
    prismaMock.oauthRefreshToken.findMany.mockResolvedValue([
      { clientId: 'client-1', expiresAt: soon },
      { clientId: 'client-1', expiresAt: later },
    ] as never)

    const [client] = await listAuthorizedClients('acct-1')

    expect(client).toMatchObject({
      consentId: 'consent-1',
      name: 'Agent',
      activeUntil: later,
    })
  })

  it('only counts refresh tokens that are not revoked', async () => {
    prismaMock.oauthConsent.findMany.mockResolvedValue([
      {
        id: 'consent-1',
        clientId: 'client-1',
        scopes: [],
        createdAt: null,
        oauthClient: { name: null, icon: null },
      },
    ] as never)
    prismaMock.oauthRefreshToken.findMany.mockResolvedValue([] as never)

    const [client] = await listAuthorizedClients('acct-1')

    expect(client!.activeUntil).toBeNull()
    expect(prismaMock.oauthRefreshToken.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ revoked: null }),
      }),
    )
  })
})

describe('revokeAuthorizedClient', () => {
  it('refuses a consent belonging to another account', async () => {
    prismaMock.oauthConsent.findUnique.mockResolvedValue({
      id: 'consent-1',
      userId: 'someone-else',
      clientId: 'client-1',
    } as never)

    const result = await revokeAuthorizedClient({
      accountId: 'acct-1',
      consentId: 'consent-1',
    })

    expect(result).toBeNull()
    expect(prismaMock.oauthConsent.delete).not.toHaveBeenCalled()
  })

  it('returns null for an unknown consent', async () => {
    prismaMock.oauthConsent.findUnique.mockResolvedValue(null as never)

    await expect(
      revokeAuthorizedClient({ accountId: 'acct-1', consentId: 'nope' }),
    ).resolves.toBeNull()
  })

  it('revokes refresh tokens rather than only dropping the consent', async () => {
    prismaMock.oauthConsent.findUnique.mockResolvedValue({
      id: 'consent-1',
      userId: 'acct-1',
      clientId: 'client-1',
    } as never)
    prismaMock.oauthRefreshToken.updateMany.mockResolvedValue({
      count: 2,
    } as never)
    prismaMock.oauthAccessToken.deleteMany.mockResolvedValue({
      count: 1,
    } as never)
    prismaMock.oauthConsent.delete.mockResolvedValue({} as never)

    const result = await revokeAuthorizedClient({
      accountId: 'acct-1',
      consentId: 'consent-1',
    })

    expect(result).toEqual({ refreshTokensRevoked: 2, accessTokensDeleted: 1 })
    expect(prismaMock.oauthRefreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'acct-1',
          clientId: 'client-1',
          revoked: null,
        }),
      }),
    )
    expect(prismaMock.oauthConsent.delete).toHaveBeenCalled()
  })
})

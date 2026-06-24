// organize-imports-ignore: ./mocks must be imported before any module that
// loads better-auth or @spliit/db so vi.mock is registered before those
// modules are evaluated.
import { describe, expect, it } from 'vitest'
import './mocks'
import { getAuthFromRequest } from '../lib/auth/session'
import { authState, prismaMock } from './state'

function makeRequest(): Request {
  return new Request('http://localhost/api/test', {
    headers: new Headers({ cookie: 'spliit.session=test-token' }),
  })
}

describe('getAuthFromRequest', () => {
  it('returns null when better-auth reports no session', async () => {
    authState.session = null

    const result = await getAuthFromRequest(makeRequest())

    expect(result).toBeNull()
    expect(prismaMock.account.findUnique).not.toHaveBeenCalled()
  })

  it('returns null when the session references an account that no longer exists', async () => {
    authState.session = {
      user: { id: 'acct-deleted' },
      session: { id: 'sess-1' },
    }
    prismaMock.account.findUnique.mockResolvedValue(null)

    const result = await getAuthFromRequest(makeRequest())

    expect(result).toBeNull()
    expect(prismaMock.account.findUnique).toHaveBeenCalledWith({
      where: { id: 'acct-deleted' },
    })
  })

  it('returns the authenticated account (refetched from the database)', async () => {
    const refreshedAccount = {
      id: 'acct-1',
      email: 'alice@example.com',
      emailVerified: true,
      name: 'Alice',
      image: null,
      createdAt: new Date('2024-01-01T00:00:00Z'),
      updatedAt: new Date('2024-06-01T00:00:00Z'),
    }
    authState.session = {
      user: { id: 'acct-1' },
      session: { id: 'sess-1' },
    }
    prismaMock.account.findUnique.mockResolvedValue(refreshedAccount)

    const result = await getAuthFromRequest(makeRequest())

    expect(result).not.toBeNull()
    expect(result?.user).toEqual(refreshedAccount)
    expect(prismaMock.account.findUnique).toHaveBeenCalledWith({
      where: { id: 'acct-1' },
    })
  })

  it('treats an unauthenticated request as no-op', async () => {
    authState.session = null
    const result = await getAuthFromRequest(makeRequest())
    expect(result).toBeNull()
  })
})

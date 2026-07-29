// organize-imports-ignore: ./mocks must be imported before any module that
// loads better-auth or @spliit/db so vi.mock is registered before those
// modules are evaluated.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import './mocks'
import {
  clearAccountCache,
  invalidateAccountCache,
} from '../lib/auth/account-cache'
import { getAuthFromRequest } from '../lib/auth/session'
import { authState, prismaMock } from './state'

function makeRequest(): Request {
  return new Request('http://localhost/api/test', {
    headers: new Headers({ cookie: 'spliit.session=test-token' }),
  })
}

describe('getAuthFromRequest', () => {
  beforeEach(() => {
    clearAccountCache()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

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

  it('reuses the authenticated account within the cache TTL', async () => {
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
    const cachedResult = await getAuthFromRequest(makeRequest())

    expect(result).not.toBeNull()
    expect(result?.user).toEqual(refreshedAccount)
    expect(cachedResult?.user).toEqual(refreshedAccount)
    expect(prismaMock.account.findUnique).toHaveBeenCalledTimes(1)
    expect(prismaMock.account.findUnique).toHaveBeenCalledWith({
      where: { id: 'acct-1' },
    })
  })

  it('refetches the account after the cache TTL expires', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-29T00:00:00.000Z'))
    authState.session = {
      user: { id: 'acct-ttl' },
      session: { id: 'sess-ttl' },
    }
    const initialAccount = {
      id: 'acct-ttl',
      email: 'alice@example.com',
      emailVerified: true,
      name: 'Alice',
    }
    const refreshedAccount = { ...initialAccount, name: 'Alice Updated' }
    prismaMock.account.findUnique
      .mockResolvedValueOnce(initialAccount as never)
      .mockResolvedValueOnce(refreshedAccount as never)

    await expect(getAuthFromRequest(makeRequest())).resolves.toMatchObject({
      user: initialAccount,
    })
    vi.advanceTimersByTime(30_001)
    await expect(getAuthFromRequest(makeRequest())).resolves.toMatchObject({
      user: refreshedAccount,
    })
    expect(prismaMock.account.findUnique).toHaveBeenCalledTimes(2)
  })

  it('refetches the account after explicit invalidation', async () => {
    authState.session = {
      user: { id: 'acct-invalidated' },
      session: { id: 'sess-invalidated' },
    }
    const initialAccount = {
      id: 'acct-invalidated',
      email: 'alice@example.com',
      emailVerified: true,
      name: 'Alice',
    }
    const updatedAccount = { ...initialAccount, name: 'Alice Updated' }
    prismaMock.account.findUnique
      .mockResolvedValueOnce(initialAccount as never)
      .mockResolvedValueOnce(updatedAccount as never)

    await getAuthFromRequest(makeRequest())
    invalidateAccountCache('acct-invalidated')
    const result = await getAuthFromRequest(makeRequest())

    expect(result?.user).toEqual(updatedAccount)
    expect(prismaMock.account.findUnique).toHaveBeenCalledTimes(2)
  })

  it('treats an unauthenticated request as no-op', async () => {
    authState.session = null
    const result = await getAuthFromRequest(makeRequest())
    expect(result).toBeNull()
  })
})

import { beforeEach, describe, expect, it } from 'vitest'

import '../../test/mocks'
import { prismaMock } from '../../test/state'
import {
  clearAccountCache,
  getCachedAccount,
  invalidateAccountCache,
} from './account-cache'

describe('account cache generation guard', () => {
  beforeEach(() => {
    clearAccountCache()
  })

  it('rejects a stale fetch that lands after invalidateAccountCache', async () => {
    const id = 'acct-race'
    const staleAccount = {
      id,
      email: 'old@example.com',
      emailVerified: false,
      name: 'Old',
      image: null,
    }
    const freshAccount = {
      id,
      email: 'new@example.com',
      emailVerified: false,
      name: 'New',
      image: null,
    }

    // First call returns the stale row; we then invalidate before it would
    // have been cached, and resolve the next fetch with the fresh row.
    let resolveFirst: (account: typeof staleAccount) => void = () => {}
    prismaMock.account.findUnique
      .mockImplementationOnce(
        () => new Promise((resolve) => (resolveFirst = resolve)) as never,
      )
      .mockResolvedValueOnce(freshAccount as never)

    const inFlight = getCachedAccount(id)
    invalidateAccountCache(id)
    resolveFirst(staleAccount as never)

    const firstResult = await inFlight
    expect(firstResult).toEqual({
      ...staleAccount,
      anonymousOnboardingCompleted: true,
    })

    // The stale row must NOT have been written to the cache; the second call
    // must hit Prisma again and return the fresh row.
    const secondResult = await getCachedAccount(id)
    expect(secondResult).toEqual({
      ...freshAccount,
      anonymousOnboardingCompleted: true,
    })
    expect(prismaMock.account.findUnique).toHaveBeenCalledTimes(2)
  })

  it('keeps a fetch that lands before invalidateAccountCache', async () => {
    const id = 'acct-normal'
    const account = {
      id,
      email: 'alice@example.com',
      emailVerified: false,
      name: 'Alice',
      image: null,
    }
    prismaMock.account.findUnique.mockResolvedValue(account as never)

    const firstResult = await getCachedAccount(id)
    invalidateAccountCache(id)

    // First result was awaited to completion before invalidate ran, so it is
    // returned regardless of the generation bump.
    expect(firstResult).toEqual({
      ...account,
      anonymousOnboardingCompleted: true,
    })
    expect(prismaMock.account.findUnique).toHaveBeenCalledTimes(1)
  })

  it('rejects concurrent fetches when clearAccountCache runs in between', async () => {
    const id = 'acct-clear'
    const firstAccount = {
      id,
      email: 'first@example.com',
      emailVerified: false,
      name: 'First',
      image: null,
    }
    const secondAccount = {
      id,
      email: 'second@example.com',
      emailVerified: false,
      name: 'Second',
      image: null,
    }

    let resolveFirst: (account: typeof firstAccount) => void = () => {}
    prismaMock.account.findUnique
      .mockImplementationOnce(
        () => new Promise((resolve) => (resolveFirst = resolve)) as never,
      )
      .mockResolvedValueOnce(secondAccount as never)

    const inFlight = getCachedAccount(id)
    clearAccountCache()
    resolveFirst(firstAccount as never)

    expect(await inFlight).toEqual({
      ...firstAccount,
      anonymousOnboardingCompleted: true,
    })
    expect(await getCachedAccount(id)).toEqual({
      ...secondAccount,
      anonymousOnboardingCompleted: true,
    })
    expect(prismaMock.account.findUnique).toHaveBeenCalledTimes(2)
  })

  it('marks an anonymous account complete only after recovery is acknowledged', async () => {
    prismaMock.account.findUnique.mockResolvedValue({
      id: 'anonymous-1',
      isAnonymous: true,
      name: 'Guest',
    } as never)
    prismaMock.anonymousRecoveryCredential.findUnique.mockResolvedValue({
      acknowledgedAt: null,
      onboardingCompletedAt: null,
    } as never)

    await expect(getCachedAccount('anonymous-1')).resolves.toMatchObject({
      id: 'anonymous-1',
      anonymousOnboardingCompleted: false,
    })

    invalidateAccountCache('anonymous-1')
    prismaMock.anonymousRecoveryCredential.findUnique.mockResolvedValue({
      acknowledgedAt: new Date(),
      onboardingCompletedAt: new Date(),
    } as never)

    await expect(getCachedAccount('anonymous-1')).resolves.toMatchObject({
      anonymousOnboardingCompleted: true,
    })
    expect(
      prismaMock.anonymousRecoveryCredential.findUnique,
    ).toHaveBeenCalledTimes(2)
  })

  it('does not look up recovery credentials for ordinary accounts', async () => {
    prismaMock.account.findUnique.mockResolvedValue({
      id: 'acct-1',
      isAnonymous: false,
      name: 'Alice',
    } as never)

    await expect(getCachedAccount('acct-1')).resolves.toMatchObject({
      anonymousOnboardingCompleted: true,
    })
    expect(
      prismaMock.anonymousRecoveryCredential.findUnique,
    ).not.toHaveBeenCalled()
  })
})

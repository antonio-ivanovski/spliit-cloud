import { afterEach, describe, expect, it } from 'vitest'

import {
  clearLastAccount,
  readLastAccount,
  writeLastAccount,
} from '@/lib/last-account'

const LAST_ACCOUNT_KEY = 'spliit:last-account'

const account = {
  id: 'user-1',
  name: 'Alice',
  email: 'alice@example.com',
  image: null,
  emailVerified: true,
  isAnonymous: false,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
}

const snapshot = {
  id: account.id,
  name: account.name,
  email: account.email,
  image: account.image,
  emailVerified: account.emailVerified,
  isAnonymous: account.isAnonymous,
  createdAt: account.createdAt.toISOString(),
  updatedAt: account.updatedAt.toISOString(),
}

describe('last-account snapshot', () => {
  afterEach(() => {
    clearLastAccount()
  })

  it('round-trips an account through localStorage', () => {
    writeLastAccount(account)
    expect(readLastAccount()).toEqual(account)
    expect(localStorage.getItem(LAST_ACCOUNT_KEY)).not.toBeNull()
    expect(sessionStorage.getItem(LAST_ACCOUNT_KEY)).toBeNull()
  })

  it('migrates a leftover sessionStorage snapshot into localStorage', () => {
    sessionStorage.setItem(LAST_ACCOUNT_KEY, JSON.stringify(snapshot))
    expect(readLastAccount()).toEqual(account)
    expect(localStorage.getItem(LAST_ACCOUNT_KEY)).toBe(
      JSON.stringify(snapshot),
    )
    expect(sessionStorage.getItem(LAST_ACCOUNT_KEY)).toBeNull()
  })

  it('returns null after clear and drops both storages', () => {
    writeLastAccount(account)
    sessionStorage.setItem(LAST_ACCOUNT_KEY, JSON.stringify(snapshot))
    clearLastAccount()
    expect(readLastAccount()).toBeNull()
    expect(localStorage.getItem(LAST_ACCOUNT_KEY)).toBeNull()
    expect(sessionStorage.getItem(LAST_ACCOUNT_KEY)).toBeNull()
  })

  it('round-trips anonymous onboarding completion', () => {
    writeLastAccount({
      ...account,
      isAnonymous: true,
      anonymousOnboardingCompleted: true,
    })
    expect(readLastAccount()).toMatchObject({
      isAnonymous: true,
      anonymousOnboardingCompleted: true,
    })
  })
})

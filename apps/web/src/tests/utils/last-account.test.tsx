import { afterEach, describe, expect, it } from 'vitest'

import {
  clearLastAccount,
  readLastAccount,
  writeLastAccount,
} from '@/lib/last-account'

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

describe('last-account snapshot', () => {
  afterEach(() => {
    clearLastAccount()
  })

  it('round-trips an account through sessionStorage', () => {
    writeLastAccount(account)
    expect(readLastAccount()).toEqual(account)
  })

  it('returns null after clear', () => {
    writeLastAccount(account)
    clearLastAccount()
    expect(readLastAccount()).toBeNull()
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
